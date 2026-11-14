# B-Z

An AI network doctor for Windows. B-Z reads your adapters (Ethernet and Wi-Fi), router, DNS and the route to the web, asks Claude what's actually wrong, then applies fixes you approve.

## What it checks

- Adapters: state, link speed, IP / gateway / DNS, Ethernet unplugged or negotiated at 100 Mbps
- Router: reachability, latency, packet loss
- Internet: ping to 1.1.1.1 and 8.8.8.8, loss, latency, jitter
- DNS: your resolver vs Cloudflare vs Google
- Web: captive-portal / proxy detection, real HTTP check
- Wi-Fi signal and approximate download speed

## Fixes (a fixed whitelist)

Open sign-in page, enable adapters, flush DNS, clear ARP, renew IP, restart adapter, Cloudflare/Google DNS, restore automatic DNS, turn off proxy, reset Winsock, reset TCP/IP.

The AI only **chooses from this list**; it can't run arbitrary commands, and nothing runs until you press **Apply**. After fixing, B-Z re-scans and shows the score change.

## AI

Open Settings (top right) and paste an Anthropic API key. It's stored encrypted with Windows DPAPI. Without a key B-Z uses its built-in rule engine. With a key, a trimmed report (adapter names, IPs, ping/DNS results; no MAC addresses) is sent to the Anthropic API.

## Build

GitHub Actions builds on every push (`.github/workflows/build.yml`):

- Download the installer and portable `.exe` from the run's **Artifacts**
- Push a tag like `v1.0.0` to publish them as a **Release**

```
git tag v1.0.0 && git push origin v1.0.0
```

Local dev (Windows):

```
npm install
npm start
npm test
npm run build
```

B-Z requests administrator rights because most fixes (DNS, adapter restart, resets) need them. The installer is unsigned, so Windows SmartScreen may warn on first run.
