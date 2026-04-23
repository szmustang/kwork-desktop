const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAppName: () => ipcRenderer.invoke('get-app-name'),
  onShowAbout: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('show-about', listener);
    return () => ipcRenderer.removeListener('show-about', listener);
  },
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
  // oauth2Login / updateBridgeConfig / onWebviewEvent 已迁移至 lingeeBridge，此处不再暴露
  onInstallProgress: (callback) => {
    ipcRenderer.on('opencode-install-progress', (_event, progress) => callback(progress));
    return () => ipcRenderer.removeAllListeners('opencode-install-progress');
  },
  // Client auto-update
  checkForClientUpdate: () => ipcRenderer.invoke('check-for-client-update'),
  downloadClientUpdate: () => ipcRenderer.invoke('download-client-update'),
  installClientUpdate: () => ipcRenderer.invoke('install-client-update'),
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

// ── lingeeBridge: 主窗口渲染进程的认证/桥接 API ──
// 登录、token 过期、配置同步等统一使用 lingeeBridge，与 webview 侧保持一致命名
contextBridge.exposeInMainWorld('lingeeBridge', {
  platform: process.platform,
  // OAuth2 云账号登录
  oauth2Login: () => ipcRenderer.invoke('oauth2-login'),
  // 渲染进程向主进程推送配置变更（auth/theme/language），主进程存储并广播到所有 webview
  updateBridgeConfig: (config) => ipcRenderer.invoke('lingeeBridge:update-config', config),
  // 监听 webview 上报的事件（主进程转发），如 token-expired
  onWebviewEvent: (callback) => {
    const listener = (_event, eventName, data) => callback(eventName, data);
    ipcRenderer.on('lingeeBridge:webview-event', listener);
    return () => ipcRenderer.removeListener('lingeeBridge:webview-event', listener);
  },
});
