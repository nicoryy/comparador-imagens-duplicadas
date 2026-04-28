'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  pickSpreadsheet: () => ipcRenderer.invoke('dialog:openSpreadsheet'),
  listSheets: (filePath) => ipcRenderer.invoke('xlsx:listSheets', filePath),
  listColumns: (args) => ipcRenderer.invoke('xlsx:listColumns', args),
  loadGroups: (args) => ipcRenderer.invoke('xlsx:loadGroups', args),
  saveStatuses: (args) => ipcRenderer.invoke('xlsx:saveStatuses', args),
  resolveImage: (absPath) => ipcRenderer.invoke('image:resolve', absPath),
  resolveRemoteImage: (url) => ipcRenderer.invoke('image:resolveRemote', url),
  platform: () => ipcRenderer.invoke('app:platform'),
  // Estado de gravação: o renderer informa ao main quando há alterações
  // pendentes ou um save em andamento, pra bloquear fechamento da janela.
  setRenderState: (state) => ipcRenderer.send('app:setRenderState', state),
  onSaveBeforeClose: (cb) => {
    const handler = (_e) => cb();
    ipcRenderer.on('app:saveBeforeClose', handler);
    return () => ipcRenderer.removeListener('app:saveBeforeClose', handler);
  },
  confirmCloseAfterSave: (ok) => ipcRenderer.send('app:confirmCloseAfterSave', !!ok),
});
