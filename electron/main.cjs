const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
const path = require('path');
const { startSidecar, killSidecar, getServerInfo, isOpencodeInstalled, getOpencodeVersion, installOpencode, checkForUpdate, updateOpencode } = require('./sidecar.cjs');

const devServerURL = process.env.VITE_DEV_SERVER_URL;

function createWindow() {
  const win = new BrowserWindow({
    title: 'Kingdee KWork',
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
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

ipcMain.handle('relaunch-app', () => {
  killSidecar();
  app.relaunch();
  app.exit(0);
});

// 强制 Chromium 使用亮色模式，影响 webview 中 prefers-color-scheme 媒体查询
// 主窗口使用硬编码暗色样式，不受此设置影响
nativeTheme.themeSource = 'light';

app.whenReady().then(createWindow);

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
