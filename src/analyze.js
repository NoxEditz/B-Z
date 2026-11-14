'use strict';

const SEV_RANK = { bad: 0, warn: 1, info: 2, ok: 3 };
const FIX_PRIORITY = [
  'open-portal', 'enable-adapters', 'flush-dns', 'flush-arp', 'renew-ip', 'restart-adapter',
  'set-dns-cloudflare', 'set-dns-google', 'disable-proxy', 'reset-winsock', 'reset-tcpip',
];

function parseLink(s) {
  const m = /([\d.]+)\s*([gmk])bps/i.exec(s || '');
  if (!m) return null;
  const n = parseFloat(m[1]);
  const mult = { g: 1000, m: 1, k: 0.001 }[m[2].toLowerCase()];
  return n * mult;
}
const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function labelFor(score, online) {
  if (!online) return 'Offline';
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Good';
  if (score >= 50) return 'Shaky';
  return 'Poor';
}

function analyze(r) {
  const findings = [];
  const fixes = new Map();
  let score = 100;
  const add = (severity, title, detail, fixIds = [], penalty = 0) => {
    findings.push({ severity, title, detail, fixes: fixIds });
    score -= penalty;
    fixIds.forEach((id) => { if (!fixes.has(id)) fixes.set(id, title); });
  };

  const adapters = r.adapters || [];
  const ping = r.ping || {};
  const primary = adapters.find((a) => a.name === r.primary) || null;
  const up = adapters.filter((a) => /^up$/i.test(a.status || ''));
  const goodIp = primary && (primary.ipv4 || []).find((x) => !x.startsWith('169.254.'));
  const apipa = primary && (primary.ipv4 || []).some((x) => x.startsWith('169.254.'));
  const gw = ping.gateway || null;
  const inet = [ping.cloudflare, ping.google].filter(Boolean);
  const sent = inet.reduce((a, p) => a + p.sent, 0);
  const got = inet.reduce((a, p) => a + p.received, 0);
  const inetUp = got > 0;
  const inetLoss = sent ? Math.round(100 - (got / sent) * 100) : null;
  const latency = avg(inet.map((p) => p.avgMs).filter((x) => x != null));
  const jitter = inet.length ? Math.max(...inet.map((p) => p.jitterMs || 0)) : null;
  const dnsSys = (r.dns || {}).system;
  const dnsPubList = [r.dns && r.dns.cloudflare, r.dns && r.dns.google].filter(Boolean);
  const pubOk = dnsPubList.some((d) => d.ok);
  const sysFail = !!(dnsSys && !dnsSys.ok);
  const webOk = !!(r.http && r.http.ok);
  const captive = !!(r.http && r.http.captive);
  const online = webOk || inetUp;
  const speed = r.speed && r.speed.mbps != null ? r.speed.mbps : null;
  const wifiSignal = r.wifi && r.wifi.signal != null ? r.wifi.signal : null;
  const onWifi = !!(primary && primary.wifi);

  const metrics = {
    latencyMs: latency,
    jitterMs: jitter,
    lossPct: inetLoss,
    downMbps: speed,
    dnsMs: dnsSys && dnsSys.ok ? dnsSys.ms : null,
    gatewayMs: gw && gw.avgMs != null ? gw.avgMs : null,
    signal: onWifi ? wifiSignal : null,
    link: primary ? primary.linkSpeed || null : null,
    adapter: primary ? primary.name : null,
    type: primary ? (primary.wifi ? 'Wi-Fi' : primary.ethernet ? 'Ethernet' : 'Network') : null,
  };

  if (r.platform !== 'win32') {
    add('info', 'Preview mode', 'B-Z’s full diagnostics and fixes run on Windows. Showing what could be measured here.');
  }

  // --- adapters ---
  if (r.platform === 'win32' && !up.length) {
    const disabled = adapters.some((a) => /disabled/i.test(a.status || ''));
    add(
      'bad',
      'No active network adapter',
      disabled ? 'Your network adapter is switched off.' : 'No adapter is connected. Check the cable or Wi-Fi.',
      disabled ? ['enable-adapters'] : [],
      100
    );
  } else if (r.platform === 'win32' && (!primary || !goodIp)) {
    add(
      'bad',
      'No valid IP address',
      apipa
        ? 'Windows gave itself a 169.254.x.x address — your router never answered the DHCP request.'
        : 'The active adapter has no usable IPv4 address or default route.',
      ['renew-ip', 'restart-adapter'],
      60
    );
  }

  // --- router ---
  if (gw && gw.received === 0) {
    if (online) {
      add('info', 'Router ignores ping', 'Your router doesn’t answer ICMP, which is common and harmless.');
    } else {
      add('bad', 'Router not responding', `Your PC can’t reach the gateway (${r.gateway}). The link to the router is down.`, ['restart-adapter', 'renew-ip'], 45);
    }
  } else if (gw && gw.lossPct > 0) {
    add('warn', 'Unstable link to router', `${gw.lossPct}% packet loss to your router points to Wi-Fi interference, a bad cable, or a flaky adapter.`, ['restart-adapter'], Math.min(25, 8 + gw.lossPct * 0.5));
  } else if (gw && gw.avgMs > 25) {
    add('warn', 'Slow link to router', `Your router takes ${gw.avgMs} ms to answer, which is high for a local network.`, [], 8);
  }

  // --- upstream ---
  if (!online && gw && gw.received > 0 && goodIp) {
    add('bad', 'Router is fine, internet is not', 'Your PC reaches the router but nothing beyond it. That usually means the modem or ISP is down. Power-cycle the modem and router for 30 seconds, then scan again.', ['renew-ip', 'flush-dns'], 50);
  }

  // --- loss / latency / jitter ---
  if (inetUp && inetLoss >= 10) {
    const local = gw && gw.lossPct > 0;
    add('warn', 'Packet loss to the internet', `${inetLoss}% of packets are lost. ${local ? 'The loss starts at your router, so the problem is local.' : 'Your router is clean, so the loss is likely your ISP or line.'}`, local ? ['restart-adapter'] : [], Math.min(30, inetLoss * 0.6));
  } else if (inetUp && inetLoss > 0) {
    add('info', 'Minor packet loss', `${inetLoss}% of packets were dropped — not worth worrying about unless it persists.`, [], 3);
  }
  if (latency != null && latency > 150) add('warn', 'Very high latency', `Average ping is ${latency} ms. Calls and games will lag.`, [], 20);
  else if (latency != null && latency > 80) add('warn', 'High latency', `Average ping is ${latency} ms.`, [], 10);
  if (jitter != null && jitter > 40) add('warn', 'Unstable latency', `Ping varies by about ${jitter} ms, which hurts calls and streaming.`, [], 10);

  // --- DNS ---
  if (sysFail && pubOk) {
    const googleBetter = dnsPubList.length === 2 && !r.dns.cloudflare.ok && r.dns.google.ok;
    add('bad', 'DNS is failing', `Names don’t resolve through your DNS servers${r.dnsServers && r.dnsServers.length ? ' (' + r.dnsServers.join(', ') + ')' : ''}, but public DNS works.`, ['flush-dns', googleBetter ? 'set-dns-google' : 'set-dns-cloudflare'], 35);
  } else if (sysFail && !pubOk && online) {
    add('warn', 'DNS traffic looks blocked', 'The internet answers pings but no DNS server responds. A firewall or VPN may be blocking port 53.', [], 15);
  } else if (dnsSys && dnsSys.ok && dnsSys.ms > 250 && pubOk) {
    const best = Math.min(...dnsPubList.filter((d) => d.ok).map((d) => d.ms));
    if (best < dnsSys.ms / 2) add('warn', 'Slow DNS', `Your DNS takes ${dnsSys.ms} ms; public DNS answers in ${best} ms.`, ['set-dns-cloudflare'], 10);
  }

  // --- web ---
  if (captive) {
    add('warn', 'A sign-in page is blocking access', 'This network shows a login page (captive portal). Sign in to get online.', ['open-portal'], 40);
  } else if (r.http && !r.http.ok && online && !sysFail) {
    add('warn', 'Web requests fail although the network is up', 'Pings work but HTTP does not. A proxy, a broken Winsock catalog, or security software could be the cause.', [r.proxy && r.proxy.enabled ? 'disable-proxy' : null, 'reset-winsock'].filter(Boolean), 25);
  }
  if (r.proxy && r.proxy.enabled) {
    add('info', 'A proxy is enabled', `Windows routes web traffic through ${r.proxy.server || 'a proxy'}. Turn it off if that isn’t intentional.`, r.http && !r.http.ok ? ['disable-proxy'] : []);
  }

  // --- speed ---
  if (speed != null) {
    if (speed < 1) add('warn', 'Extremely slow download', `Measured about ${speed} Mbps.`, [], 30);
    else if (speed < 5) add('warn', 'Slow download speed', `Measured about ${speed} Mbps — fine for browsing, rough for video.`, [], 15);
  }

  // --- wi-fi ---
  if (onWifi && wifiSignal != null) {
    if (wifiSignal < 40) add('warn', 'Weak Wi-Fi signal', `Signal is ${wifiSignal}%. Move closer to the router or switch to Ethernet.`, [], 15);
    else if (wifiSignal < 60) add('info', 'Fair Wi-Fi signal', `Signal is ${wifiSignal}%.`, [], 5);
  }

  // --- ethernet ---
  for (const a of adapters) {
    if (!a.ethernet || a.virtual) continue;
    if (/disconnected/i.test(a.status || '') && onWifi) {
      add('info', 'Ethernet cable not connected', `“${a.name}” is unplugged. A cable is usually faster and steadier than Wi-Fi.`);
    } else if (/^up$/i.test(a.status || '')) {
      const mbps = parseLink(a.linkSpeed);
      if (mbps != null && mbps > 0 && mbps <= 100) {
        add('info', 'Ethernet linked at 100 Mbps or less', `“${a.name}” negotiated ${a.linkSpeed}. A damaged cable or old port/router can cap speed below gigabit.`);
      }
    }
  }

  if (!findings.some((f) => f.severity === 'bad' || f.severity === 'warn')) {
    add('ok', 'All clear', 'Adapters, router, DNS and web access all check out.');
  }

  if (!online) score = Math.min(score, 25);
  score = clamp(Math.round(score), 0, 100);

  // --- path ---
  const slow = dnsSys && dnsSys.ok && dnsSys.ms > 250;
  const pathNodes = [
    { id: 'pc', label: 'This PC', status: r.platform === 'win32' ? (up.length && goodIp ? 'ok' : 'bad') : 'ok' },
    { id: 'router', label: 'Router', status: !gw ? (r.gateway ? 'unknown' : r.platform === 'win32' ? 'bad' : 'unknown') : gw.received === 0 ? (online ? 'ok' : 'bad') : gw.lossPct > 0 || gw.avgMs > 25 ? 'warn' : 'ok' },
    { id: 'dns', label: 'DNS', status: !dnsSys ? 'unknown' : sysFail ? 'bad' : slow ? 'warn' : 'ok' },
    { id: 'internet', label: 'Internet', status: !online ? 'bad' : captive || (inetLoss != null && inetLoss >= 10) || (latency != null && latency > 150) ? 'warn' : 'ok' },
  ];
  let broke = false;
  for (const n of pathNodes) {
    if (broke && n.status === 'bad') n.status = 'unknown';
    if (n.status === 'bad') broke = true;
  }

  findings.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
  const fixList = [...fixes.entries()]
    .sort((a, b) => FIX_PRIORITY.indexOf(a[0]) - FIX_PRIORITY.indexOf(b[0]))
    .map(([id, reason]) => ({ id, reason }));

  const top = findings.find((f) => f.severity === 'bad') || findings.find((f) => f.severity === 'warn');
  const summary = top
    ? `${top.title}. ${top.detail}`
    : 'Your connection looks healthy. Nothing needs fixing.';

  return { score, label: labelFor(score, online), online, path: pathNodes, metrics, findings, fixes: fixList, summary };
}

module.exports = { analyze, FIX_PRIORITY };
