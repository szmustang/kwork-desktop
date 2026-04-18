const { app, BrowserWindow, ipcMain, nativeTheme, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const { startSidecar, killSidecar, getServerInfo, isOpencodeInstalled, getOpencodeVersion, checkPendingUpdate } = require('./sidecar.cjs');

const devServerURL = process.env.VITE_DEV_SERVER_URL;

// 禁止 macOS 恢复上次窗口状态（最小化/隐藏记忆），这是打包后窗口不弹出的根本原因
app.commandLine.appendSwitch('disable-features', 'WidgetLayering');
app.commandLine.appendSwitch('disable-mac-app-state-restoration');

let mainWindow = null;
let forceQuit = false;

function createWindow() {
  mainWindow = new BrowserWindow({
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

  // 窗口创建后立即最大化（不使用 ready-to-show，避免 macOS 窗口状态恢复竞态）
  mainWindow.maximize();

  // 页面加载完成后聚焦窗口
  mainWindow.webContents.once('did-finish-load', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.focus();
      if (process.platform === 'darwin') {
        app.focus({ steal: true });
      }
    }
  });

  // macOS: 点红色关闭按钮只隐藏窗口，不销毁，保留页面状态
  if (process.platform === 'darwin') {
    mainWindow.on('close', (e) => {
      if (!forceQuit) {
        e.preventDefault();
        mainWindow.hide();
      }
    });
  }

  if (devServerURL) {
    mainWindow.loadURL(devServerURL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
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

// Check if there's a pending update
ipcMain.handle('check-pending-update', async () => {
  try {
    const result = await checkPendingUpdate();
    return result;
  } catch (err) {
    return { hasUpdate: false, error: err.message };
  }
});

// install-opencode and update-opencode removed:
// opencode binary is bundled via seedBundledBinary(); updates are applied
// automatically from ~/.kcode/updates/update-pending.json on each launch.

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

// 为 kcode-web webview 注入 preload，使其内部页面可调用 electronAPI（如 selectFolder）
// 仅对 localhost 来源的 webview 注入，避免外部页面获得桥接能力
app.on('web-contents-created', (_, contents) => {
  contents.on('will-attach-webview', (_event, webPreferences, params) => {
    const src = params.src || '';
    if (!src.startsWith('http://localhost') && !src.startsWith('http://127.0.0.1')) return;
    webPreferences.preload = path.join(__dirname, 'webview-preload.cjs');
    webPreferences.contextIsolation = true;
    webPreferences.nodeIntegration = false;
  });
});

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
  }
  createWindow();
}).catch((err) => {
  console.error('[main] whenReady failed:', err);
});

app.on('window-all-closed', () => {
  // macOS: 关闭窗口不退出应用，也不杀 sidecar，点击 Dock 可直接恢复
  if (process.platform !== 'darwin') {
    killSidecar();
    app.quit();
  }
});

app.on('before-quit', () => {
  forceQuit = true;
  killSidecar();
});

// Last resort: ensure sidecar is killed when Node process exits
process.on('exit', () => {
  killSidecar();
});

app.on('activate', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();  // 先恢复最小化状态
    }
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
});
