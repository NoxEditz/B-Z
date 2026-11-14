'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('bz', {
  info: () => ipcRenderer.invoke('app:info'),
  scan: () => ipcRenderer.invoke('scan:start'),
  fix: (ids) => ipcRenderer.invoke('fix:apply', ids),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (p) => ipcRenderer.invoke('settings:set', p),
  openConsole: () => ipcRenderer.invoke('app:open', 'https://console.anthropic.com/'),
  onScanStep: (cb) => on('scan:step', cb),
  onFixStep: (cb) => on('fix:step', cb),
});
