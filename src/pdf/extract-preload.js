// Bridge for the hidden window that reads text out of a PDF. It can receive one job and
// send one result back; nothing else in the app is reachable from here.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pdfHost', {
  ready: () => ipcRenderer.send('pdf:ready'),
  onJob: (handler) => ipcRenderer.once('pdf:job', (_event, job) => handler(job)),
  done: (result) => ipcRenderer.send('pdf:done', result),
});
