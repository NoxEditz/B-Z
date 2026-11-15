'use strict';
const { app, BrowserWindow, ipcMain, shell, safeStorage, net, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const { collect, ping } = require('./src/diagnostics');
const { fastest } = require('./src/providers');
const { analyze } = require('./src/analyze');
const { applyFix, CATALOG, ORDER } = require('./src/fixes');
const { askClaude, friendlyError, DEFAULT_MODEL } = require('./src/ai');
const { isAdmin } = require('./src/util');

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let busy = false;
let last = null; // { report, analysis }

/* ---------- settings (API key is encrypted with Windows DPAPI via safeStorage) ---------- */

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}
function saveSettings(s) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
}
function getKey() {
  const s = loadSettings();
  if (!s.apiKey) return null;
  try {
    if (s.enc) return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(s.apiKey, 'base64')) : null;
    return s.apiKey;
  } catch {
    return null;
  }
}
function publicSettings() {
  const s = loadSettings();
  return { hasKey: !!getKey(), model: s.model || DEFAULT_MODEL, autoVerify: s.autoVerify !== false };
}

const publicCatalog = () =>
  Object.fromEntries(
    Object.entries(CATALOG).map(([id, m]) => [id, { title: m.title, desc: m.desc, risk: m.risk, admin: m.admin, reboot: m.reboot }])
  );

/* ---------- window ---------- */

function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 960,
    minHeight: 660,
    backgroundColor: '#060608',
    title: 'B-Z',
    icon: path.join(__dirname, 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#060608', symbolColor: '#f5f4f8', height: 44 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

/* ---------- auto-update (GitHub Releases). Never allowed to break the app. ---------- */
let updater = null;
function setupUpdater() {
  if (!app.isPackaged) return;
  try {
    ({ autoUpdater: updater } = require('electron-updater'));
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    const send = (p) => {
      if (win && !win.isDestroyed()) win.webContents.send('update:status', p);
    };
    updater.on('update-available', (i) => send({ state: 'downloading', version: i.version }));
    updater.on('update-downloaded', (i) => send({ state: 'ready', version: i.version }));
    updater.on('error', () => {}); // offline, no release yet, rate-limited... all fine
    setTimeout(() => updater.checkForUpdates().catch(() => {}), 8000);
  } catch {
    updater = null;
  }
}
ipcMain.handle('update:install', () => {
  if (updater) updater.quitAndInstall(false, true);
});

app.whenReady().then(() => {
  createWindow();
  setupUpdater();
});
app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
app.on('window-all-closed', () => app.quit());

/* ---------- IPC ---------- */

ipcMain.handle('app:info', async () => ({
  version: app.getVersion(),
  platform: process.platform,
  admin: await isAdmin(),
  catalog: publicCatalog(),
  settings: publicSettings(),
}));

ipcMain.handle('settings:get', () => publicSettings());

ipcMain.handle('settings:set', (_e, p) => {
  const s = loadSettings();
  if (p && p.clearKey) {
    delete s.apiKey;
    delete s.enc;
  } else if (p && typeof p.apiKey === 'string' && p.apiKey.trim()) {
    const key = p.apiKey.trim().slice(0, 300);
    if (safeStorage.isEncryptionAvailable()) {
      s.apiKey = safeStorage.encryptString(key).toString('base64');
      s.enc = true;
    } else {
      s.apiKey = key;
      s.enc = false;
    }
  }
  if (p && typeof p.model === 'string' && /^[\w.\-]{3,64}$/.test(p.model.trim())) s.model = p.model.trim();
  if (p && typeof p.autoVerify === 'boolean') s.autoVerify = p.autoVerify;
  saveSettings(s);
  return publicSettings();
});

ipcMain.handle('app:open', (_e, url) => {
  if (url === 'https://console.anthropic.com/') shell.openExternal(url);
});

const stripPrivate = (report) => ({
  ...report,
  adapters: report.adapters.map(({ name, description, status, linkSpeed, wifi, ethernet, virtual, ipv4, gateway, dns }) => ({
    name, description, status, linkSpeed, wifi, ethernet, virtual, ipv4, gateway, dns,
  })),
});

ipcMain.handle('scan:start', async (e) => {
  if (busy) return { error: 'A scan is already running.' };
  busy = true;
  stopMonitor(); // keep the live pinger from skewing the scan
  const send = (ch, p) => {
    if (!e.sender.isDestroyed()) e.sender.send(ch, p);
  };
  try {
    const report = await collect({ fetchImpl: (u, o) => net.fetch(u, o), onStep: (s) => send('scan:step', s) });
    report.admin = await isAdmin();
    const local = analyze(report);
    let analysis = { ...local, source: 'local' };

    const key = getKey();
    if (key && local.online) {
      send('scan:step', { id: 'ai', state: 'start' });
      try {
        const ai = await askClaude({
          apiKey: key,
          model: loadSettings().model || DEFAULT_MODEL,
          report,
          local,
          fetchImpl: (u, o) => net.fetch(u, o),
        });
        analysis = { ...ai, source: 'ai', model: loadSettings().model || DEFAULT_MODEL };
      } catch (err) {
        analysis.aiError = friendlyError(err);
      }
      send('scan:step', { id: 'ai', state: 'done' });
    } else if (key && !local.online) {
      analysis.aiError = 'You’re offline, so the AI can’t be reached — used the built-in rules instead.';
    }

    last = { report, analysis };
    return { report: stripPrivate(report), analysis };
  } catch (err) {
    return { error: `Scan failed: ${(err && err.message) || err}` };
  } finally {
    busy = false;
  }
});

/* ---------- live pulse: 1 Hz ping to router + internet ---------- */
let monitor = null;
function stopMonitor() {
  if (monitor) clearInterval(monitor.timer);
  monitor = null;
}
ipcMain.handle('monitor:start', (e) => {
  if (monitor) return true;
  const gateway = last && last.report ? last.report.gateway : null;
  let inFlight = false;
  const timer = setInterval(async () => {
    if (inFlight || e.sender.isDestroyed()) return;
    inFlight = true;
    try {
      const [net1, rt] = await Promise.all([ping('1.1.1.1', 1), gateway ? ping(gateway, 1) : Promise.resolve(null)]);
      if (!e.sender.isDestroyed()) {
        e.sender.send('monitor:tick', {
          t: Date.now(),
          internet: net1.received ? (net1.avgMs ?? null) : null,
          router: rt ? (rt.received ? (rt.avgMs ?? null) : null) : undefined,
        });
      }
    } finally {
      inFlight = false;
    }
  }, 1000);
  monitor = { timer };
  return true;
});
ipcMain.handle('monitor:stop', () => {
  stopMonitor();
  return true;
});
app.on('before-quit', stopMonitor);

ipcMain.handle('fix:apply', async (e, ids) => {
  if (!Array.isArray(ids)) return [];
  const send = (ch, p) => {
    if (!e.sender.isDestroyed()) e.sender.send(ch, p);
  };
  const wanted = ids.filter((i) => typeof i === 'string' && CATALOG[i]);
  wanted.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));

  const names = last ? last.report.adapters.map((a) => a.name) : [];
  const adapter = last && names.includes(last.report.primary) ? last.report.primary : null;
  const ctx = { adapter, admin: await isAdmin(), shell, fastest: last ? fastest(last.report.dns) : null };

  const results = [];
  for (const id of wanted) {
    send('fix:step', { id, state: 'start' });
    const res = await applyFix(id, ctx);
    send('fix:step', { state: 'done', ...res });
    results.push(res);
  }
  return results;
});
