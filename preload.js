const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  openLogin: () => ipcRenderer.invoke('open-login'),
  setCookie: (cookie) => ipcRenderer.invoke('set-cookie', cookie),
  platform: process.platform,
  desktopLyrics: Object.freeze({
    open: (bounds) => ipcRenderer.invoke('desktop-lyrics:open', bounds),
    close: () => ipcRenderer.invoke('desktop-lyrics:close'),
    layout: (enabled) => ipcRenderer.invoke('desktop-lyrics:set-layout-mode', enabled),
    lock: (locked) => ipcRenderer.invoke('desktop-lyrics:set-lock', locked),
    applyPreset: (placement, displayId) => ipcRenderer.invoke('desktop-lyrics:apply-preset', Object.assign(new Object(), { placement, displayId })),
    state: (state) => ipcRenderer.invoke('desktop-lyrics:state', state),
    displays: () => ipcRenderer.invoke('desktop-lyrics:list-displays'),
    setDisplay: (displayId) => ipcRenderer.invoke('desktop-lyrics:set-display', displayId),
    reset: (displayId, placement) => ipcRenderer.invoke('desktop-lyrics:reset', Object.assign(new Object(), { displayId, placement })),
    onLayoutResult(callback) {
      if (typeof callback !== 'function') throw new TypeError('onLayoutResult requires a callback');
      const listener = (_event, result) => callback(result);
      ipcRenderer.on('desktop-lyrics:layout-result', listener);
      return () => ipcRenderer.removeListener('desktop-lyrics:layout-result', listener);
    },
  }),
});
