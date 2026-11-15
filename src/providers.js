'use strict';

/** DNS providers B-Z races against your current DNS. */
const PROVIDERS = [
  { id: 'cloudflare', name: 'Cloudflare', servers: ['1.1.1.1', '1.0.0.1'] },
  { id: 'google', name: 'Google', servers: ['8.8.8.8', '8.8.4.4'] },
  { id: 'quad9', name: 'Quad9', servers: ['9.9.9.9', '149.112.112.112'] },
  { id: 'opendns', name: 'OpenDNS', servers: ['208.67.222.222', '208.67.220.220'] },
];

/** Fastest provider that answered, from a report's dns section. */
function fastest(dnsReport) {
  let best = null;
  for (const p of PROVIDERS) {
    const d = dnsReport && dnsReport[p.id];
    if (d && d.ok && d.ms != null && (!best || d.ms < best.ms)) best = { ...p, ms: d.ms };
  }
  return best;
}

module.exports = { PROVIDERS, fastest };
