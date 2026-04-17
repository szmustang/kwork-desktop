const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  getServerInfo: () => ipcRenderer.invoke('get-server-info'),
  killSidecar: () => ipcRenderer.invoke('kill-sidecar'),
  // Opencode management
  checkOpencode: () => ipcRenderer.invoke('check-opencode'),
  getOpencodeVersion: () => ipcRenderer.invoke('get-opencode-version'),
  installOpencode: () => ipcRenderer.invoke('install-opencode'),
  startSidecar: () => ipcRenderer.invoke('start-sidecar'),
  // Update
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  updateOpencode: () => ipcRenderer.invoke('update-opencode'),
  relaunchApp: () => ipcRenderer.invoke('relaunch-app'),
  toggleDevTools: () => ipcRenderer.invoke('toggle-devtools'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  onInstallProgress: (callback) => {
    ipcRenderer.on('opencode-install-progress', (_event, progress) => callback(progress));
    return () => ipcRenderer.removeAllListeners('opencode-install-progress');
  },
});
