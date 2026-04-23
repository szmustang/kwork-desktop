const { contextBridge, ipcRenderer } = require('electron');

// ── lingeeBridge: 主窗口渲染进程统一桥接 API ──
// 所有能力（应用管理、认证、配置同步、文件系统、自动更新等）统一挂载在 lingeeBridge 上
contextBridge.exposeInMainWorld('lingeeBridge', {
  platform: process.platform,

  // ── 应用信息与控制 ──
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAppName: () => ipcRenderer.invoke('get-app-name'),
  onShowAbout: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('show-about', listener);
    return () => ipcRenderer.removeListener('show-about', listener);
  },
  relaunchApp: () => ipcRenderer.invoke('relaunch-app'),
  toggleDevTools: () => ipcRenderer.invoke('toggle-devtools'),

  // ── 文件系统 ──
  selectFolder: (options) => ipcRenderer.invoke('select-folder', options),
  openPath: (targetPath) => ipcRenderer.invoke('open-path', targetPath),

  // ── Sidecar 管理 ──
  getServerInfo: () => ipcRenderer.invoke('get-server-info'),
  killSidecar: () => ipcRenderer.invoke('kill-sidecar'),
  startSidecar: () => ipcRenderer.invoke('start-sidecar'),

  // ── Opencode 管理 ──
  checkOpencode: () => ipcRenderer.invoke('check-opencode'),
  getOpencodeVersion: () => ipcRenderer.invoke('get-opencode-version'),
  checkPendingUpdate: () => ipcRenderer.invoke('check-pending-update'),
  installOpencode: () => ipcRenderer.invoke('install-opencode'),
  getInstallState: () => ipcRenderer.invoke('get-install-state'),
  onInstallProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('opencode-install-progress', listener);
    return () => ipcRenderer.removeListener('opencode-install-progress', listener);
  },

  // ── OAuth2 认证 ──
  oauth2Login: () => ipcRenderer.invoke('oauth2-login'),

  // ── 通用 HTTP 代理（绕过渲染进程 CORS 限制，由主进程发起请求） ──
  proxyFetch: (url, options) => ipcRenderer.invoke('lingeeBridge:proxy-fetch', url, options),

  // ── 配置同步（auth/theme/language），主进程存储并广播到所有 webview ──
  updateBridgeConfig: (config) => ipcRenderer.invoke('lingeeBridge:update-config', config),

  // ── 监听 webview 上报的事件（主进程转发），如 token-expired ──
  onWebviewEvent: (callback) => {
    const listener = (_event, eventName, data) => callback(eventName, data);
    ipcRenderer.on('lingeeBridge:webview-event', listener);
    return () => ipcRenderer.removeListener('lingeeBridge:webview-event', listener);
  },

  // ── 客户端自动更新 ──
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
