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
assert.ok(ids(a).includes('flush-dns') && ids(a).includes('set-dns-cloudflare'));
assert.ok(!ids(a).includes('set-dns-google'));
assert.equal(a.path[2].status, 'bad');
assert.ok(a.score < 75);

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

console.log('B-Z self-test: all checks passed');
