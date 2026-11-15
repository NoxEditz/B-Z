'use strict';
// Dependency-free self-test: rule engine, AI reply sanitising, fix catalog integrity.
const assert = require('node:assert/strict');
const { analyze } = require('../src/analyze');
const { _test, } = require('../src/ai');
const { CATALOG, ORDER } = require('../src/fixes');

const ping = (sent, received, avgMs = 20, jitterMs = 2) => ({ sent, received, lossPct: Math.round(((sent - received) / sent) * 100), avgMs, jitterMs });
const adapter = (o = {}) => ({ name: 'Ethernet', status: 'Up', linkSpeed: '1 Gbps', wifi: false, ethernet: true, virtual: false, ipv4: ['192.168.1.20'], gateway: '192.168.1.1', dns: ['192.168.1.1'], ...o });
const base = (o = {}) => ({
  platform: 'win32', adapters: [adapter()], primary: 'Ethernet', gateway: '192.168.1.1', dnsServers: ['192.168.1.1'],
  proxy: { enabled: false }, wifi: null,
  ping: { gateway: ping(4, 4, 2), cloudflare: ping(5, 5, 20), google: ping(5, 5, 22) },
  dns: { system: { ok: true, ms: 30 }, cloudflare: { ok: true, ms: 20 }, google: { ok: true, ms: 25 } },
  http: { ok: true, captive: false }, speed: { mbps: 120 }, ...o,
});
const ids = (a) => a.fixes.map((f) => f.id);

// healthy
let a = analyze(base());
assert.ok(a.score >= 95, 'healthy score');
assert.equal(a.fixes.length, 0);
assert.equal(a.findings[0].severity, 'ok');
assert.deepEqual(a.path.map((n) => n.status), ['ok', 'ok', 'ok', 'ok']);

// DNS broken, public works
a = analyze(base({ dns: { system: { ok: false }, cloudflare: { ok: true, ms: 20 }, google: { ok: true, ms: 25 } }, http: { ok: false, error: 'x' } }));
assert.ok(ids(a).includes('flush-dns') && ids(a).includes('set-dns-fastest'));
assert.ok(!ids(a).includes('set-dns-google'));
assert.equal(a.race.best, 'cloudflare');
assert.match(a.fixes.find((f) => f.id === 'set-dns-fastest').reason, /Cloudflare answered in 20 ms/);
assert.equal(a.path[2].status, 'bad');
assert.ok(a.score < 75);

// fastest provider is chosen from the race (Quad9 wins here)
a = analyze(base({ dns: { system: { ok: false }, cloudflare: { ok: true, ms: 40 }, google: { ok: true, ms: 35 }, quad9: { ok: true, ms: 9 }, opendns: { ok: false } }, http: { ok: false } }));
assert.equal(a.race.best, 'quad9');
assert.equal(require('../src/providers').fastest({ cloudflare: { ok: true, ms: 40 }, quad9: { ok: true, ms: 9 } }).id, 'quad9');

// slow system DNS but a much faster provider
a = analyze(base({ dns: { system: { ok: true, ms: 400 }, cloudflare: { ok: true, ms: 15 }, google: { ok: true, ms: 30 } } }));
assert.ok(a.findings.some((f) => f.title === 'Slow DNS') && ids(a).includes('set-dns-fastest'));

// wrong clock
a = analyze(base({ http: { ok: true, captive: false, clockSkewSec: 5400 } }));
assert.ok(ids(a).includes('sync-time'));
a = analyze(base({ http: { ok: true, captive: false, clockSkewSec: 3 } }));
assert.ok(!ids(a).includes('sync-time'));

// power-saving only matters when the link is flaky
a = analyze(base({ adapters: [adapter({ powerSave: true })], ping: { gateway: ping(4, 3), cloudflare: ping(5, 5), google: ping(5, 5) } }));
assert.ok(ids(a).includes('disable-power-saving'));
a = analyze(base({ adapters: [adapter({ powerSave: true })] }));
assert.ok(!ids(a).includes('disable-power-saving'));

// slow download on a clean line suggests TCP auto-tuning
a = analyze(base({ speed: { mbps: 2.5 } }));
assert.ok(ids(a).includes('optimize-tcp'));

// no IP (APIPA)
a = analyze(base({ adapters: [adapter({ ipv4: ['169.254.3.4'] })], ping: {}, dns: { system: { ok: false }, cloudflare: { ok: false }, google: { ok: false } }, http: { ok: false } }));
assert.ok(ids(a).includes('renew-ip'));
assert.equal(a.online, false);
assert.equal(a.label, 'Offline');
assert.equal(a.path[0].status, 'bad');
assert.ok(a.path.slice(1).every((n) => n.status !== 'bad'), 'only first break is red');

// no adapter up
a = analyze(base({ adapters: [adapter({ status: 'Disabled' })], primary: null, ping: {}, dns: {}, http: { ok: false } }));
assert.ok(ids(a).includes('enable-adapters'));

// captive portal
a = analyze(base({ http: { ok: false, captive: true } }));
assert.ok(ids(a).includes('open-portal'));

// router ignores ping but internet works => not an error
a = analyze(base({ ping: { gateway: ping(4, 0), cloudflare: ping(5, 5), google: ping(5, 5) } }));
assert.ok(a.score >= 95);
assert.ok(!a.findings.some((f) => f.severity === 'bad'));

// modem/ISP down: router ok, internet dead
a = analyze(base({ ping: { gateway: ping(4, 4), cloudflare: ping(5, 0), google: ping(5, 0) }, dns: { system: { ok: false }, cloudflare: { ok: false }, google: { ok: false } }, http: { ok: false } }));
assert.ok(a.findings.some((f) => /Router is fine/.test(f.title)));
assert.equal(a.online, false);

// weak wifi + slow speed
a = analyze(base({ adapters: [adapter({ name: 'Wi-Fi', wifi: true, ethernet: false })], primary: 'Wi-Fi', wifi: { signal: 25 }, speed: { mbps: 0.6 } }));
assert.ok(a.findings.some((f) => /Weak Wi-Fi/.test(f.title)));
assert.ok(a.findings.some((f) => /slow/i.test(f.title)));

// ethernet at 100 Mbps
a = analyze(base({ adapters: [adapter({ linkSpeed: '100 Mbps' })] }));
assert.ok(a.findings.some((f) => /100 Mbps/.test(f.title)));

// AI reply sanitising: unknown fix ids, bad severities, junk are dropped; extra prose around JSON tolerated
const local = analyze(base());
const raw = _test.extractJson('Sure!\n```json\n{"summary":"All good","score":"88","findings":[{"severity":"nope","title":"T","detail":"D","fixes":["flush-dns","rm -rf /"]}],"fixes":[{"id":"flush-dns","reason":"r"},{"id":"format-c","reason":"x"},{"id":"flush-dns","reason":"dup"}]}\n```');
const s = _test.sanitize(raw, local);
assert.equal(s.score, 88);
assert.equal(s.findings[0].severity, 'info');
assert.deepEqual(s.findings[0].fixes, ['flush-dns']);
assert.deepEqual(s.fixes.map((f) => f.id), ['flush-dns']);
assert.throws(() => _test.extractJson('no json here'));
assert.throws(() => _test.sanitize(null, local));

// catalog integrity
for (const id of Object.keys(CATALOG)) assert.ok(ORDER.includes(id), `${id} missing from ORDER`);
for (const id of ORDER) assert.ok(CATALOG[id], `${id} missing from CATALOG`);
assert.ok(_test.buildPrompt(base(), local).length < 8000, 'prompt stays small');

// packaging config: installer only, upgrade-in-place, branded assets present
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');
const targets = JSON.stringify(pkg.build.win.target);
assert.ok(/nsis/.test(targets) && !/portable/.test(targets), 'installer only, no portable');
assert.ok(!pkg.build.portable, 'no portable section');
assert.ok(pkg.build.appId && pkg.build.nsis.guid, 'fixed appId + guid so new setups replace old installs');
assert.equal(pkg.build.nsis.perMachine, false);
for (const f of [pkg.build.win.icon, pkg.build.nsis.installerSidebar, pkg.build.nsis.installerHeader, pkg.build.nsis.include]) {
  assert.ok(fs.existsSync(path.join(__dirname, '..', f)), `missing ${f}`);
}
assert.ok(pkg.dependencies['electron-updater'], 'updater is a runtime dependency');

console.log('B-Z self-test: all checks passed');
