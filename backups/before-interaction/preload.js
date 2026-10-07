const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widget', {
  close: () => ipcRenderer.send('window:close'),
  hide: () => ipcRenderer.send('window:hide'),
  pin: (on) => ipcRenderer.send('window:pin', on),
  setLayout: (mode) => ipcRenderer.send('window:layout', mode),
  startDrag: (point) => ipcRenderer.send('window:drag-start', point),
  moveDrag: () => ipcRenderer.send('window:drag-move'),
  endDrag: () => ipcRenderer.send('window:drag-end'),
  onDragging: (cb) => { ipcRenderer.on('window:dragging', () => cb()); },
  toggleGhost: () => ipcRenderer.invoke('ghost:toggle'),
  onGhost: (cb) => ipcRenderer.on('ghost:changed', (e, on) => cb(on)),
  getAutostart: () => ipcRenderer.invoke('autostart:get'),
  setAutostart: (on) => ipcRenderer.invoke('autostart:set', on),
  nudge: (msg) => ipcRenderer.send('window:nudge', msg)
});
