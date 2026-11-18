// Bridge between the app shell (toolbar, mascot, bubbles) and the main process.
// The API key never crosses this bridge; the renderer only sends questions and receives text.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('companion', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  openSettings: () => ipcRenderer.invoke('settings:open'),
  openTokenFactory: () => ipcRenderer.invoke('open-token-factory'),
  // Asks the background process to take the key from the clipboard. Only { ok, reason } comes back.
  useCopiedKey: () => ipcRenderer.invoke('key:from-clipboard'),
  onOpenTab: (handler) => ipcRenderer.on('open-tab', (_event, url, sourceId) => handler(url, sourceId)),
  capture: (webContentsId, rect) => ipcRenderer.invoke('capture', { webContentsId, rect }),
  // Text of the PDF a tab is showing. Only the tab is named; the background process looks up its address.
  readPdf: (webContentsId) => ipcRenderer.invoke('pdf:text', { webContentsId }),
  ask: (request) => ipcRenderer.send('ask:start', request),
  cancel: (id) => ipcRenderer.send('ask:cancel', id),
  onAskEvent: (handler) => ipcRenderer.on('ask:event', (_event, payload) => handler(payload)),
  onCommand: (handler) => ipcRenderer.on('command', (_event, name) => handler(name)),
});
