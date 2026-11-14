'use strict';
const os = require('node:os');
const dns = require('node:dns');
const { run, ps, isWin, withTimeout } = require('./util');

const HOST = 'www.microsoft.com';

/* ---------- system / adapters ---------- */

const SYSTEM_SCRIPT = `
$ErrorActionPreference='SilentlyContinue'
$cfg = @(Get-NetIPConfiguration | ForEach-Object { [pscustomobject]@{ name=$_.InterfaceAlias; description=$_.InterfaceDescription; ipv4=@($_.IPv4Address | ForEach-Object { $_.IPAddress }); gateway=[string]$_.IPv4DefaultGateway.NextHop; dns=@($_.DNSServer | Where-Object { $_.AddressFamily -eq 2 } | ForEach-Object { $_.ServerAddresses }) } })
$phys = @(Get-NetAdapter -Physical | ForEach-Object { [pscustomobject]@{ name=$_.Name; description=$_.InterfaceDescription; status=[string]$_.Status; linkSpeed=[string]$_.LinkSpeed; media=[string]$_.PhysicalMediaType } })
$route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object { $_.RouteMetric + $_.InterfaceMetric } | Select-Object -First 1
$ie = Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
$proxy = [pscustomobject]@{ enabled=([int]$ie.ProxyEnable -eq 1); server=[string]$ie.ProxyServer }
[pscustomobject]@{ cfg=$cfg; phys=$phys; route=[pscustomobject]@{ alias=[string]$route.InterfaceAlias; hop=[string]$route.NextHop }; proxy=$proxy } | ConvertTo-Json -Depth 6 -Compress
`;

const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const isWifiAdapter = (a) =>
  /802\.11/.test(a.media || '') || /wi-?fi|wireless|wlan|802\.11/i.test(`${a.name} ${a.description}`);
const isEthAdapter = (a) =>
  /802\.3/.test(a.media || '') || (/ethernet/i.test(a.name || '') && !isWifiAdapter(a));

async function readSystemWindows() {
  const r = await ps(SYSTEM_SCRIPT, { timeout: 25000 });
  let j;
  try {
    j = JSON.parse(r.stdout.trim());
  } catch {
    throw new Error('Could not read adapter information');
  }
  const cfg = arr(j.cfg);
  const phys = arr(j.phys);
  const adapters = [];
  for (const p of phys) {
    const c = cfg.find((x) => x.name === p.name) || {};
    adapters.push({
      name: p.name,
      description: p.description,
      status: p.status,
      linkSpeed: p.linkSpeed,
      media: p.media,
      virtual: false,
      ipv4: arr(c.ipv4),
      gateway: c.gateway || null,
      dns: arr(c.dns),
    });
  }
  for (const c of cfg) {
    if (!adapters.find((a) => a.name === c.name)) {
      adapters.push({
        name: c.name,
        description: c.description,
        status: 'Up',
        linkSpeed: '',
        media: '',
        virtual: true,
        ipv4: arr(c.ipv4),
        gateway: c.gateway || null,
        dns: arr(c.dns),
      });
    }
  }
  adapters.forEach((a) => {
    a.wifi = isWifiAdapter(a);
    a.ethernet = isEthAdapter(a);
  });
  const hop = j.route && j.route.hop && j.route.hop !== '0.0.0.0' ? j.route.hop : null;
  const primary = j.route && j.route.alias ? j.route.alias : null;
  const pa = adapters.find((a) => a.name === primary);
  return {
    adapters,
    primary,
    gateway: hop || (pa && pa.gateway) || null,
    dnsServers: pa ? pa.dns : [],
    proxy: { enabled: !!(j.proxy && j.proxy.enabled), server: (j.proxy && j.proxy.server) || null },
  };
}

function readSystemGeneric() {
  const adapters = [];
  const ifs = os.networkInterfaces();
  for (const [name, list] of Object.entries(ifs)) {
    const v4 = (list || []).filter((i) => i.family === 'IPv4' && !i.internal);
    if (!v4.length) continue;
    adapters.push({
      name, description: name, status: 'Up', linkSpeed: '', media: '', virtual: false,
      ipv4: v4.map((i) => i.address), gateway: null, dns: [], wifi: /^wl/i.test(name), ethernet: /^(en|eth)/i.test(name),
    });
  }
  return { adapters, primary: adapters[0] ? adapters[0].name : null, gateway: null, dnsServers: [], proxy: { enabled: false, server: null } };
}

async function readWifi() {
  if (!isWin) return null;
  const r = await run('netsh', ['wlan', 'show', 'interfaces'], { timeout: 8000 });
  if (r.code !== 0) return null;
  const m = r.stdout.match(/(\d{1,3})\s*%/);
  return m ? { signal: Math.min(100, parseInt(m[1], 10)) } : null;
}

/* ---------- ping ---------- */

async function ping(host, count = 4) {
  const args = isWin ? ['-n', String(count), '-w', '2000', host] : ['-c', String(count), '-W', '2', host];
  const r = await run('ping', args, { timeout: 20000 });
  const lines = r.stdout.split(/\r?\n/);
  const times = [];
  let received = 0;
  for (const line of lines) {
    if (!/ttl=\d+/i.test(line)) continue;
    received++;
    const m = line.match(/[=<]\s*([\d.]+)\s*ms/i);
    if (m) times.push(parseFloat(m[1]));
  }
  const out = { host, sent: count, received, lossPct: Math.round(((count - received) / count) * 100) };
  if (times.length) {
    const sum = times.reduce((a, b) => a + b, 0);
    out.avgMs = Math.round(sum / times.length);
    out.minMs = Math.round(Math.min(...times));
    out.maxMs = Math.round(Math.max(...times));
    let d = 0;
    for (let i = 1; i < times.length; i++) d += Math.abs(times[i] - times[i - 1]);
    out.jitterMs = times.length > 1 ? Math.round(d / (times.length - 1)) : 0;
  }
  return out;
}

/* ---------- dns ---------- */

async function timeDns(fn) {
  const t = performance.now();
  try {
    await withTimeout(fn(), 4000, 'ETIMEOUT');
    return { ok: true, ms: Math.round(performance.now() - t) };
  } catch (e) {
    return { ok: false, ms: null, error: String((e && (e.code || e.message)) || e) };
  }
}
const viaServer = (ip) =>
  timeDns(async () => {
    const r = new dns.promises.Resolver({ timeout: 2000, tries: 1 });
    r.setServers([ip]);
    const a = await r.resolve4(HOST);
    if (!a.length) throw new Error('EMPTY');
  });

/* ---------- web + speed ---------- */

async function webCheck(fetchImpl) {
  const t = Date.now();
  try {
    const res = await withTimeout(fetchImpl('http://www.msftconnecttest.com/connecttest.txt', { cache: 'no-store' }), 7000);
    const body = (await res.text()).trim();
    const expected = body === 'Microsoft Connect Test';
    return { ok: res.ok && expected, status: res.status, ms: Date.now() - t, captive: !expected && res.status < 400 };
  } catch (e1) {
    try {
      const t2 = Date.now();
      const res = await withTimeout(fetchImpl('http://connectivitycheck.gstatic.com/generate_204', { cache: 'no-store' }), 7000);
      return { ok: res.status === 204, status: res.status, ms: Date.now() - t2, captive: res.status === 200 };
    } catch (e2) {
      return { ok: false, error: String((e2 && e2.message) || e2) };
    }
  }
}

async function speedTest(fetchImpl) {
  const ctl = new AbortController();
  const killer = setTimeout(() => ctl.abort(), 9000);
  let bytes = 0;
  let firstChunk = 0;
  let tFirst = null;
  try {
    const res = await fetchImpl('https://speed.cloudflare.com/__down?bytes=8000000', { signal: ctl.signal, cache: 'no-store' });
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (tFirst === null) {
        tFirst = Date.now();
        firstChunk = value.length;
      }
      bytes += value.length;
    }
  } catch (e) {
    if (tFirst === null) return { mbps: null, error: String((e && e.message) || e) };
  } finally {
    clearTimeout(killer);
  }
  const secs = (Date.now() - tFirst) / 1000;
  const measured = bytes - firstChunk;
  if (secs <= 0.05 || measured < 50000) return { mbps: null, error: 'too little data' };
  return { mbps: Math.round(((measured * 8) / secs / 1e6) * 10) / 10, bytes };
}

/* ---------- orchestrator ---------- */

async function collect({ fetchImpl = globalThis.fetch, onStep = () => {} } = {}) {
  const report = {
    ts: new Date().toISOString(),
    platform: process.platform,
    adapters: [],
    primary: null,
    gateway: null,
    dnsServers: [],
    proxy: { enabled: false, server: null },
    wifi: null,
    ping: {},
    dns: {},
    http: null,
    speed: null,
    errors: [],
  };
  const step = async (id, fn) => {
    onStep({ id, state: 'start' });
    try {
      await fn();
    } catch (e) {
      report.errors.push(`${id}: ${(e && e.message) || e}`);
    }
    onStep({ id, state: 'done' });
  };

  await step('adapters', async () => {
    Object.assign(report, isWin ? await readSystemWindows() : readSystemGeneric());
  });

  await Promise.all([
    step('gateway', async () => {
      if (report.gateway) report.ping.gateway = await ping(report.gateway, 4);
      const p = report.adapters.find((a) => a.name === report.primary);
      if (p && p.wifi) report.wifi = await readWifi();
    }),
    step('internet', async () => {
      const [cf, g] = await Promise.all([ping('1.1.1.1', 5), ping('8.8.8.8', 5)]);
      report.ping.cloudflare = cf;
      report.ping.google = g;
    }),
    step('dns', async () => {
      const [system, cloudflare, google] = await Promise.all([
        timeDns(() => dns.promises.lookup(HOST, { family: 4 })),
        viaServer('1.1.1.1'),
        viaServer('8.8.8.8'),
      ]);
      report.dns = { system, cloudflare, google };
    }),
  ]);

  await step('web', async () => {
    report.http = await webCheck(fetchImpl);
  });
  await step('speed', async () => {
    if (report.http && report.http.ok) report.speed = await speedTest(fetchImpl);
  });
  return report;
}

module.exports = { collect, ping, _internals: { isWifiAdapter, isEthAdapter } };
