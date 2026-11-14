'use strict';
const { run, ps, isWin } = require('./util');

/**
 * The ONLY things B-Z (or the AI) can ever do to your PC.
 * The AI picks ids from this catalog; it can never supply a command.
 */
const CATALOG = {
  'open-portal': {
    title: 'Open sign-in page',
    desc: 'Opens a plain-HTTP page so this network can show its login screen.',
    risk: 'safe', admin: false, reboot: false, needsAdapter: false,
  },
  'enable-adapters': {
    title: 'Enable disabled adapters',
    desc: 'Turns on physical network adapters that are switched off.',
    risk: 'safe', admin: true, reboot: false, needsAdapter: false,
  },
  'flush-dns': {
    title: 'Flush DNS cache',
    desc: 'Clears Windows’ cached name lookups.',
    risk: 'safe', admin: true, reboot: false, needsAdapter: false,
  },
  'flush-arp': {
    title: 'Clear ARP cache',
    desc: 'Forgets cached router/device address mappings.',
    risk: 'safe', admin: true, reboot: false, needsAdapter: false,
  },
  'renew-ip': {
    title: 'Renew IP address',
    desc: 'Releases and re-requests an address from your router (brief disconnect).',
    risk: 'low', admin: true, reboot: false, needsAdapter: false,
  },
  'restart-adapter': {
    title: 'Restart network adapter',
    desc: 'Disables and re-enables your active adapter.',
    risk: 'low', admin: true, reboot: false, needsAdapter: true,
  },
  'set-dns-cloudflare': {
    title: 'Use Cloudflare DNS',
    desc: 'Sets DNS on your active adapter to 1.1.1.1 / 1.0.0.1.',
    risk: 'medium', admin: true, reboot: false, needsAdapter: true,
  },
  'set-dns-google': {
    title: 'Use Google DNS',
    desc: 'Sets DNS on your active adapter to 8.8.8.8 / 8.8.4.4.',
    risk: 'medium', admin: true, reboot: false, needsAdapter: true,
  },
  'reset-dns-auto': {
    title: 'Restore automatic DNS',
    desc: 'Gets DNS servers from your router again (undoes the DNS fixes).',
    risk: 'low', admin: true, reboot: false, needsAdapter: true,
  },
  'disable-proxy': {
    title: 'Turn off proxy',
    desc: 'Disables the Windows proxy and resets the WinHTTP proxy.',
    risk: 'medium', admin: true, reboot: false, needsAdapter: false,
  },
  'reset-winsock': {
    title: 'Reset Winsock',
    desc: 'Rebuilds the Windows socket catalog. Needs a restart.',
    risk: 'medium', admin: true, reboot: true, needsAdapter: false,
  },
  'reset-tcpip': {
    title: 'Reset TCP/IP stack',
    desc: 'Resets the IP stack to defaults. Needs a restart.',
    risk: 'high', admin: true, reboot: true, needsAdapter: false,
  },
};

/** Order fixes run in (gentle → heavy). */
const ORDER = [
  'open-portal', 'enable-adapters', 'flush-dns', 'flush-arp', 'renew-ip', 'restart-adapter',
  'set-dns-cloudflare', 'set-dns-google', 'reset-dns-auto', 'disable-proxy', 'reset-winsock', 'reset-tcpip',
];

const clean = (s) =>
  String(s || '')
    .replace(/#< CLIXML/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/_x000D__x000A_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const snip = (s, n = 220) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

async function psFix(body, env, okText) {
  const r = await ps(
    `$ErrorActionPreference='Stop'; try { ${body} } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`,
    { env, timeout: 60000 }
  );
  if (r.code === 0) return { ok: true, output: snip(clean(r.stdout)) || okText };
  return { ok: false, output: snip(clean(r.stderr) || clean(r.stdout) || 'The command failed.') };
}

const runners = {
  'open-portal': async ({ shell }) => {
    await shell.openExternal('http://neverssl.com');
    return { ok: true, output: 'Opened neverssl.com — sign in on the page that appears.' };
  },
  'enable-adapters': () =>
    psFix(
      "Get-NetAdapter -Physical | Where-Object { $_.Status -eq 'Disabled' } | Enable-NetAdapter -Confirm:$false; 'Enabled disabled adapters.'",
      {},
      'Enabled disabled adapters.'
    ),
  'flush-dns': async () => {
    const r = await run('ipconfig', ['/flushdns']);
    return { ok: r.code === 0, output: r.code === 0 ? 'DNS cache flushed.' : snip(clean(r.stdout || r.stderr)) };
  },
  'flush-arp': async () => {
    const r = await run('netsh', ['interface', 'ip', 'delete', 'arpcache']);
    return { ok: r.code === 0, output: r.code === 0 ? 'ARP cache cleared.' : snip(clean(r.stdout || r.stderr)) };
  },
  'renew-ip': async () => {
    await run('ipconfig', ['/release'], { timeout: 30000 });
    const r = await run('ipconfig', ['/renew'], { timeout: 45000 });
    return { ok: r.code === 0, output: r.code === 0 ? 'IP address renewed.' : snip(clean(r.stdout || r.stderr)) };
  },
  'restart-adapter': ({ adapter }) =>
    psFix(
      "Restart-NetAdapter -Name $env:BZ_ADAPTER -Confirm:$false; Start-Sleep 4; 'Restarted adapter: ' + $env:BZ_ADAPTER",
      { BZ_ADAPTER: adapter },
      'Adapter restarted.'
    ),
  'set-dns-cloudflare': ({ adapter }) =>
    psFix(
      "Set-DnsClientServerAddress -InterfaceAlias $env:BZ_ADAPTER -ServerAddresses @('1.1.1.1','1.0.0.1'); Clear-DnsClientCache; 'DNS set to Cloudflare on ' + $env:BZ_ADAPTER",
      { BZ_ADAPTER: adapter },
      'DNS set to Cloudflare.'
    ),
  'set-dns-google': ({ adapter }) =>
    psFix(
      "Set-DnsClientServerAddress -InterfaceAlias $env:BZ_ADAPTER -ServerAddresses @('8.8.8.8','8.8.4.4'); Clear-DnsClientCache; 'DNS set to Google on ' + $env:BZ_ADAPTER",
      { BZ_ADAPTER: adapter },
      'DNS set to Google.'
    ),
  'reset-dns-auto': ({ adapter }) =>
    psFix(
      "Set-DnsClientServerAddress -InterfaceAlias $env:BZ_ADAPTER -ResetServerAddresses; Clear-DnsClientCache; 'DNS back to automatic on ' + $env:BZ_ADAPTER",
      { BZ_ADAPTER: adapter },
      'DNS restored to automatic.'
    ),
  'disable-proxy': () =>
    psFix(
      "Set-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' -Name ProxyEnable -Value 0; netsh winhttp reset proxy | Out-Null; 'Proxy turned off.'",
      {},
      'Proxy turned off.'
    ),
  'reset-winsock': async () => {
    const r = await run('netsh', ['winsock', 'reset']);
    return { ok: r.code === 0, output: r.code === 0 ? 'Winsock reset. Restart Windows to finish.' : snip(clean(r.stdout || r.stderr)) };
  },
  'reset-tcpip': async () => {
    const r = await run('netsh', ['int', 'ip', 'reset']);
    return { ok: r.code === 0, output: r.code === 0 ? 'TCP/IP reset. Restart Windows to finish.' : snip(clean(r.stdout || r.stderr)) };
  },
};

async function applyFix(id, ctx) {
  const meta = CATALOG[id];
  if (!meta || !runners[id]) return { id, ok: false, output: 'Unknown fix.' };
  if (id !== 'open-portal' && !isWin) return { id, ok: false, output: 'Fixes are only available on Windows.' };
  if (meta.admin && !ctx.admin) return { id, ok: false, output: 'Needs administrator rights — restart B-Z as administrator.' };
  if (meta.needsAdapter && !ctx.adapter) return { id, ok: false, output: 'No active adapter known — run a scan first.' };
  try {
    const res = await runners[id](ctx);
    return { id, ok: !!res.ok, output: res.output, reboot: !!(res.ok && meta.reboot) };
  } catch (e) {
    return { id, ok: false, output: snip(String((e && e.message) || e)) };
  }
}

module.exports = { CATALOG, ORDER, applyFix };
