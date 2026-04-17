const { app, BrowserWindow, ipcMain, nativeTheme, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const { startSidecar, killSidecar, getServerInfo, isOpencodeInstalled, getOpencodeVersion, installOpencode, checkForUpdate, updateOpencode } = require('./sidecar.cjs');

const devServerURL = process.env.VITE_DEV_SERVER_URL;

function createWindow() {
  const win = new BrowserWindow({
    title: '',
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 12 },
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      webSecurity: false,
    },
  });

  win.maximize();

  if (devServerURL) {
    win.loadURL(devServerURL);
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// IPC handlers
ipcMain.handle('get-server-info', async () => {
  try {
    await startSidecar();
    return getServerInfo();
  } catch {
    return null;
  }
});

ipcMain.handle('kill-sidecar', () => {
  killSidecar();
});

// Opencode management IPC
ipcMain.handle('check-opencode', () => {
  return { installed: isOpencodeInstalled() };
});

ipcMain.handle('get-opencode-version', async () => {
  const version = await getOpencodeVersion();
  return { version };
});

ipcMain.handle('install-opencode', async (event) => {
  try {   
    await installOpencode((progress) => {
      // Send progress to renderer
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win && !win.isDestroyed()) {
        win.webContents.send('opencode-install-progress', progress);
      }
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('toggle-devtools', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    if (win.webContents.isDevToolsOpened()) {
      win.webContents.closeDevTools();
    } else {
      win.webContents.openDevTools();
    }
  }
});

ipcMain.handle('start-sidecar', async () => {
  try {
    const info = await startSidecar();
    return { success: true, ...info };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('check-update', async () => {
  try {
    return await checkForUpdate();
  } catch (err) {
    console.error('[Main] check-update error:', err);
    return { hasUpdate: false, error: err.message };
  }
});

ipcMain.handle('update-opencode', async (event) => {
  try {
    await updateOpencode((progress) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win && !win.isDestroyed()) {
        win.webContents.send('opencode-install-progress', progress);
      }
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });
  if (result.canceled) return { canceled: true };
  return { canceled: false, path: result.filePaths[0] };
});

ipcMain.handle('relaunch-app', () => {
  killSidecar();
  app.relaunch();
  app.exit(0);
});

// 设置应用名称
app.name = 'Kingdee KWork';

// 强制 Chromium 使用亮色模式，影响 webview 中 prefers-color-scheme 媒体查询
// 主窗口使用硬编码暗色样式，不受此设置影响
nativeTheme.themeSource = 'light';

app.whenReady().then(() => {
  // 自定义菜单，使 macOS 菜单栏显示正确的应用名称（必须在 app ready 之后）
  const appName = 'Kingdee KWork';
  if (process.platform === 'darwin') {
    const template = [
      {
        label: appName,
        submenu: [
          { role: 'about', label: `About ${appName}` },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide', label: `Hide ${appName}` },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit', label: `Quit ${appName}` },
        ],
      },
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    // 设置 Dock 图标（macOS squircle 规范图标）
    const iconPath = path.join(__dirname, '../build/icon-macos.png');
    app.dock.setIcon(iconPath);
  }
  createWindow();
});

app.on('window-all-closed', () => {
  killSidecar();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  killSidecar();
});

// Last resort: ensure sidecar is killed when Node process exits
process.on('exit', () => {
  killSidecar();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
