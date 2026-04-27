/**
 * LingeeBridge — webview 专用 preload 脚本
 *
 * 通过 will-attach-webview 自动注入到所有 <webview> 标签。
 * 向 webview 内页面暴露 window.lingeeBridge 接口，
 * 遵循 LingeeBridge 桥接协议规范。
 */
const { contextBridge, ipcRenderer } = require('electron');

// ── 内部状态 ──

// 同步获取初始配置（preload 在页面脚本之前执行，保证 getConfig() 立即可用）
let _config = ipcRenderer.sendSync('lingeeBridge:get-config');

// 回调注册表
const _configCallbacks = new Set();
const _stopCallbacks = new Set();

// ── 宿主推送监听 ──

// 配置变更推送
ipcRenderer.on('lingeeBridge:config-changed', (_event, config) => {
  _config = config;
  for (const cb of _configCallbacks) {
    try {
      cb(config);
    } catch (e) {
      console.error('[LingeeBridge] onConfigChanged callback error:', e);
    }
  }
});

// 停止请求推送
ipcRenderer.on('lingeeBridge:stop-requested', () => {
  for (const cb of _stopCallbacks) {
    try {
      cb();
    } catch (e) {
      console.error('[LingeeBridge] onStopRequested callback error:', e);
    }
  }
});

// ── 暴露 window.lingeeBridge ──

contextBridge.exposeInMainWorld('lingeeBridge', {
  // ── 环境与配置 ──
  platform: process.platform,

  getConfig: () => ({ ..._config }),

  onConfigChanged: (callback) => {
    _configCallbacks.add(callback);
    return () => _configCallbacks.delete(callback);
  },

  // ── 文件系统 ──
  selectFolder: (options) => ipcRenderer.invoke('select-folder', options),
  openPath: (targetPath) => ipcRenderer.invoke('open-path', targetPath),

  // ── 系统能力 ──
  openLink: (url) => ipcRenderer.invoke('lingeeBridge:open-link', url),
  copyToClipboard: (text) => ipcRenderer.invoke('lingeeBridge:copy-to-clipboard', text),

  // ── 事件上报（被嵌套端 → 宿主） ──
  notify: (event, data) => ipcRenderer.invoke('lingeeBridge:notify', event, data),

  // ── HTTP 代理（绕过 CORS） ──
  // Node.js 主进程发起请求，不受浏览器跨域限制
  proxyFetch: (url, options) => ipcRenderer.invoke('lingeeBridge:proxy-fetch', url, options),

  // ── 开发环境配置 API（HMAC 签名在主进程完成，密钥不暴露给 webview） ──
  devEnvFetch: (path, queryParams) => ipcRenderer.invoke('lingeeBridge:dev-env-fetch', { path, queryParams }),

  // ── 已签名的后端 API 代理（HMAC 签名在主进程完成，密钥不暴露给 webview） ──
  signedBackendFetch: (url, options) => ipcRenderer.invoke('lingeeBridge:signed-backend-fetch', url, options),

  // ── 生命周期 ──
  onStopRequested: (callback) => {
    _stopCallbacks.add(callback);
    return () => _stopCallbacks.delete(callback);
  },
});
