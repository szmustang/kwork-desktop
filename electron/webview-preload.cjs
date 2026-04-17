/**
 * Webview 专用 preload 脚本
 *
 * 通过 will-attach-webview 自动注入到所有 <webview> 标签。
 * 只暴露 webview 内页面（kcode-web）所需的最小 API 子集。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  selectFolder: () => ipcRenderer.invoke('select-folder'),
});
