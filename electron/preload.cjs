const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  getServerInfo: () => ipcRenderer.invoke('get-server-info'),
  killSidecar: () => ipcRenderer.invoke('kill-sidecar'),
  // Opencode management
  checkOpencode: () => ipcRenderer.invoke('check-opencode'),
  getOpencodeVersion: () => ipcRenderer.invoke('get-opencode-version'),
  checkPendingUpdate: () => ipcRenderer.invoke('check-pending-update'),
  installOpencode: () => ipcRenderer.invoke('install-opencode'),
  getInstallState: () => ipcRenderer.invoke('get-install-state'),
  startSidecar: () => ipcRenderer.invoke('start-sidecar'),
  relaunchApp: () => ipcRenderer.invoke('relaunch-app'),
  toggleDevTools: () => ipcRenderer.invoke('toggle-devtools'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  openPath: (targetPath) => ipcRenderer.invoke('open-path', targetPath),
  onInstallProgress: (callback) => {
    ipcRenderer.on('opencode-install-progress', (_event, progress) => callback(progress));
    return () => ipcRenderer.removeAllListeners('opencode-install-progress');
  },
  // Client auto-update
  checkForClientUpdate: () => ipcRenderer.invoke('check-for-client-update'),
  downloadClientUpdate: () => ipcRenderer.invoke('download-client-update'),
  onClientUpdateAvailable: (cb) => {
    const listener = (_, data) => cb(data);
    ipcRenderer.on('client-update-available', listener);
    return () => ipcRenderer.removeListener('client-update-available', listener);
  },
  onClientDownloadProgress: (cb) => {
    const listener = (_, data) => cb(data);
    ipcRenderer.on('client-download-progress', listener);
    return () => ipcRenderer.removeListener('client-download-progress', listener);
  },
  onClientUpdateDownloaded: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('client-update-downloaded', listener);
    return () => ipcRenderer.removeListener('client-update-downloaded', listener);
  },
  onClientUpdateError: (cb) => {
    const listener = (_, error) => cb(error);
    ipcRenderer.on('client-update-error', listener);
    return () => ipcRenderer.removeListener('client-update-error', listener);
  },
});
