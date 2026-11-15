# B-Z

An AI network doctor for Windows. B-Z reads your adapters (Ethernet and Wi-Fi), router, DNS and the route to the web, asks Claude what's actually wrong, then applies fixes you approve.

## What it checks

- **Adapters**: state, link speed, IP / gateway / DNS, Ethernet unplugged or negotiated at 100 Mbps, power-saving, active VPNs
- **Router**: reachability, latency, packet loss
- **Internet**: ping to 1.1.1.1 and 8.8.8.8, loss, latency, jitter
- **DNS race**: your resolver vs Cloudflare, Google, Quad9 and OpenDNS, drawn as a live race
- **Web**: captive-portal and proxy detection, real HTTP check, clock skew
- **Wi-Fi** signal and approximate download speed
- **Live pulse**: a 1-second ping graph so you can watch the connection react as you move or unplug things

## Fixes (a fixed whitelist)

Open sign-in page, sync clock, enable adapters, stop adapter power-saving, restart Wi-Fi service, flush DNS, clear ARP, renew IP, restart adapter, **switch to the fastest DNS**, Cloudflare/Google DNS, restore automatic DNS (one-click undo), turn off proxy, restore TCP auto-tuning, reset Winsock, reset TCP/IP.

The AI only **chooses from this list**; it can't run arbitrary commands, and nothing runs until you press **Apply**. After fixing, B-Z re-scans and shows the score change.

## AI

Open Settings (top right) and paste an Anthropic API key. It's stored encrypted with Windows DPAPI. Without a key B-Z uses its built-in rule engine. With a key, a trimmed report (adapter names, IPs, ping/DNS results; no MAC addresses) is sent to the Anthropic API.

## Install and update

Download `B-Z-Setup-x.y.z.exe` from the latest Release. Running a newer Setup **replaces the old version in place** and keeps your settings. Installed copies also check GitHub Releases on startup and offer a one-click "Restart to update".

The installer is unsigned, so Windows SmartScreen may warn on first run (More info, then Run anyway).

## Build

GitHub Actions builds the installer on every push (`.github/workflows/build.yml`):

- Download `B-Z-Setup-*.exe` from the run's **Artifacts**
- Push a tag to publish a **Release** (the version is taken from the tag):

```
git tag v1.1.0 && git push origin v1.1.0
```

Local dev (Windows):

```
npm install
npm start
npm test
npm run build
```
