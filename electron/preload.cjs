const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  getServerInfo: () => ipcRenderer.invoke('get-server-info'),
  killSidecar: () => ipcRenderer.invoke('kill-sidecar'),
  // Opencode management
  checkOpencode: () => ipcRenderer.invoke('check-opencode'),
  getOpencodeVersion: () => ipcRenderer.invoke('get-opencode-version'),
  checkPendingUpdate: () => ipcRenderer.invoke('check-pending-update'),
  startSidecar: () => ipcRenderer.invoke('start-sidecar'),
  relaunchApp: () => ipcRenderer.invoke('relaunch-app'),
  toggleDevTools: () => ipcRenderer.invoke('toggle-devtools'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  openPath: (targetPath) => ipcRenderer.invoke('open-path', targetPath),
  onInstallProgress: (callback) => {
    ipcRenderer.on('opencode-install-progress', (_event, progress) => callback(progress));
    return () => ipcRenderer.removeAllListeners('opencode-install-progress');
  },
});
