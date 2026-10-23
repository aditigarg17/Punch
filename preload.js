const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('punchDesktop', {
  // main page -> widget
  sync: active => ipcRenderer.send('sync', active),
  toast: msg => ipcRenderer.send('toast', String(msg)),
  // widget -> main
  checkout: () => ipcRenderer.send('checkout'),
  openMain: () => ipcRenderer.send('open-main'),
  resize: h => ipcRenderer.send('resize', h),
  ready: () => ipcRenderer.send('widget-ready'),
  onState: cb => ipcRenderer.on('state', (_e, s) => cb(s)),
  onToast: cb => ipcRenderer.on('toast', (_e, m) => cb(m))
});
