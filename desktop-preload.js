'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopLyricsAPI', Object.freeze({
  onState(callback) {
    if (typeof callback !== 'function') throw new TypeError('onState requires a callback');
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('desktop-lyrics:state', listener);
    return () => ipcRenderer.removeListener('desktop-lyrics:state', listener);
  },
  setBounds: (bounds) => ipcRenderer.invoke('desktop-lyrics:set-bounds', bounds),
  finishLayout: () => ipcRenderer.invoke('desktop-lyrics:set-layout-mode', false),
}));
