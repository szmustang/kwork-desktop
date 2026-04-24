const { app, BrowserWindow, ipcMain, nativeTheme, Menu, nativeImage, dialog, shell, clipboard, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');
const { startSidecar, killSidecar, getServerInfo, isOpencodeInstalled, checkOpencodeInstalled, backgroundUpdateCheck, getOpencodeVersion, checkPendingUpdate, installOpencode, getInstallState, installEvents, resolveShellEnv } = require('./sidecar.cjs');
const { startOAuth2Login } = require('./oauth2.cjs');
const { LINGEE_BASE_URL } = require('./constants.cjs');
const devServerURL = process.env.VITE_DEV_SERVER_URL;

// 禁止 macOS 恢复上次窗口状态（最小化/隐藏记忆），这是打包后窗口不弹出的根本原因
app.commandLine.appendSwitch('disable-features', 'WidgetLayering');
app.commandLine.appendSwitch('disable-mac-app-state-restoration');

let mainWindow = null;
let forceQuit = false;
let downloadedFilePath = null; // 保存下载的更新文件路径

// ── LingeeBridge 配置状态 ──
// 由渲染进程推送，主进程作为 webview 配置的单一数据源
let currentBridgeConfig = {
  language: 'zh-CN',
  theme: 'light',
  auth: null,
  hostVersion: '0.0.0', // app ready 后更新
};

// ── Bridge Config 持久化 ──
// 将 auth 和 language 统一持久化到一个文件，保证状态原子性。
// 解决退出应用后重启 webview 白屏问题（auth 丢失）以及语言偏好恢复。
const BRIDGE_PERSIST_FILE = path.join(app.getPath('userData'), 'bridge-persist.json');

/**
 * 将需要持久化的 bridge 字段写入磁盘。
 * 只持久化 auth 和 language，其他字段（theme / hostVersion）由运行时决定。
 */
function persistBridgeConfig() {
  try {
    const payload = {
      auth: currentBridgeConfig.auth || null,
      language: currentBridgeConfig.language || 'zh-CN',
    };
    fs.writeFile(BRIDGE_PERSIST_FILE, JSON.stringify(payload), 'utf-8', (err) => {
      if (err) console.warn('[BridgePersist] write failed:', err.message);
    });
  } catch (err) {
    console.warn('[BridgePersist] persist failed:', err.message);
  }
}

/**
 * 启动时从磁盘恢复 auth 和 language。
 * auth 会做结构校验 + 过期检查，无效则丢弃。
 */
function restoreBridgeConfig() {
  try {
    if (!fs.existsSync(BRIDGE_PERSIST_FILE)) return;
    const raw = fs.readFileSync(BRIDGE_PERSIST_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return;

    // 恢复 language
    if (typeof data.language === 'string') {
      currentBridgeConfig.language = data.language;
    }

    // 恢复 auth（含校验）
    const auth = data.auth;
    if (auth && typeof auth === 'object' && auth.token) {
      // token 过期检查
      if (auth.expiresAt && Date.now() >= auth.expiresAt) {
        console.warn('[BridgePersist] restored token expired, discarding auth');
      } else {
        currentBridgeConfig.auth = auth;
      }
    }
  } catch (err) {
    console.warn('[BridgePersist] restore failed:', err.message);
  }
}

// 启动时立即恢复，确保 webview 首次 get-config 就能拿到有效 token 和语言
restoreBridgeConfig();

/** 向所有 webview 广播消息 */
function broadcastToWebviews(channel, ...args) {
  for (const wc of webContents.getAllWebContents()) {
    if (wc.getType() === 'webview' && !wc.isDestroyed()) {
      try {
        wc.send(channel, ...args);
      } catch (err) {
        // webview 可能在 isDestroyed() 检查后被销毁（TOCTOU 竞态）
        console.warn('[broadcastToWebviews] send failed:', err.message);
      }
    }
  }
}

function createWindow() {
  const isWin = process.platform === 'win32';
  mainWindow = new BrowserWindow({
    title: '',
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hidden',
    titleBarOverlay: isWin ? { color: '#00000000', symbolColor: '#666666', height: 40 } : undefined,
    trafficLightPosition: { x: 12, y: 12 },
    backgroundColor: '#ffffff',
    show: false, // 延迟显示窗口，避免 Windows 下启动白屏闪烁
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      webSecurity: false,
    },
  });

  // 页面加载完成后再显示并最大化窗口，避免启动白屏闪烁
  let windowShown = false;
  const showWindow = () => {
    if (windowShown || !mainWindow || mainWindow.isDestroyed()) return;
    windowShown = true;
    mainWindow.maximize();
    mainWindow.show();
    mainWindow.focus();
    if (process.platform === 'darwin') {
      app.focus({ steal: true });
    }
  };
  mainWindow.webContents.once('did-finish-load', showWindow);
  // 安全兜底：如果页面加载失败，超时后仍显示窗口，避免应用无响应
  setTimeout(showWindow, 8000);

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

  // 拦截外部链接，用系统默认浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      require('electron').shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}

// IPC handlers
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('get-app-name', () => {
  return app.name;
});

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
ipcMain.handle('check-opencode', async () => {
  // Apply pending update first: if a pre-downloaded version exists,
  // replace the binary BEFORE checking existence — avoids unnecessary CDN re-download.
  try {
    const { applyPendingUpdate } = require('./sidecar.cjs');
    const updateResult = await applyPendingUpdate();
    if (updateResult.applied) {
      console.log('[Main] Applied pending update to v' + updateResult.version + ' before check');
    }
  } catch (err) {
    console.warn('[Main] applyPendingUpdate before check failed:', err.message);
  }
  return checkOpencodeInstalled();
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

// Install opencode from CDN (first launch when no binary exists)
ipcMain.handle('install-opencode', async () => {
  return await installOpencode();
});

// Get current install state (for UI polling)
ipcMain.handle('get-install-state', () => {
  return getInstallState();
});

ipcMain.handle('toggle-devtools', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    if (win.webContents.isDevToolsOpened()) {
      win.webContents.closeDevTools();
    } else {
      win.webContents.openDevTools({ mode: 'detach' });
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

ipcMain.handle('oauth2-login', async () => {
  try {
    const result = await startOAuth2Login();
    // 登录成功后聚焦主窗口，用户无感从浏览器回到应用
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
    return { success: true, data: result };
  } catch (err) {
    // 返回 errorCode 供渲染进程映射 i18n，原始 message 仅供调试
    return { success: false, errorCode: err.code || 'FAILED', error: err.message };
  }
});



ipcMain.handle('select-folder', async (_event, options) => {
  const result = await dialog.showOpenDialog({
    title: options?.title,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled) return { canceled: true };
  return { canceled: false, path: result.filePaths[0] };
});

ipcMain.handle('open-path', async (_event, targetPath) => {
  if (!targetPath || typeof targetPath !== 'string') return { success: false, error: 'Invalid path' };
  const errorMessage = await shell.openPath(targetPath);
  // shell.openPath returns empty string on success, error message on failure
  return errorMessage ? { success: false, error: errorMessage } : { success: true };
});

ipcMain.handle('relaunch-app', () => {
  killSidecar();
  app.relaunch();
  app.exit(0);
});

// ── LingeeBridge IPC handlers ──

// 同步：webview preload 启动时获取初始配置
ipcMain.on('lingeeBridge:get-config', (event) => {
  event.returnValue = currentBridgeConfig;
});

// 渲染进程推送配置变更 → 存储 + 广播到所有 webview
ipcMain.handle('lingeeBridge:update-config', (event, config) => {
  // 仅接受主窗口渲染进程的配置推送，拒绝 webview 侧的篡改
  if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false };
  if (!config || typeof config !== 'object') return { ok: false };
  const prevAuth = currentBridgeConfig.auth;
  const prevLang = currentBridgeConfig.language;
  // hostVersion 始终由主进程提供，避免渲染进程异步加载期间覆写为 'unknown'
  currentBridgeConfig = { ...config, hostVersion: app.getVersion() };
  // 仅在 auth 实际变化时才持久化，避免 theme/language 变更触发不必要的磁盘写入
  const currAuth = currentBridgeConfig.auth;
  if ((prevAuth?.token ?? null) !== (currAuth?.token ?? null)) {
    persistBridgeConfig();
  } else if (config.language && config.language !== prevLang) {
    // auth 未变但 language 变了，也需要持久化
    persistBridgeConfig();
  }
  broadcastToWebviews('lingeeBridge:config-changed', currentBridgeConfig);
  return { ok: true };
});

// 在系统默认浏览器中打开 URL
ipcMain.handle('lingeeBridge:open-link', async (_event, url) => {
  if (!url || typeof url !== 'string') return;
  // 安全校验：仅允许 http/https 协议，拒绝 file://、javascript:、自定义协议等
  if (!url.startsWith('https://') && !url.startsWith('http://')) return;
  await shell.openExternal(url);
});

// 写入系统剪贴板
ipcMain.handle('lingeeBridge:copy-to-clipboard', (_event, text) => {
  if (typeof text !== 'string') return false;
  try {
    clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error('[LingeeBridge] clipboard write failed:', err);
    return false;
  }
});

// 通用 HTTP 代理：webview 侧通过 lingeeBridge.proxyFetch() 发起跨域请求
// Node.js 主进程不受 CORS 限制，可直接请求任意外部 API
ipcMain.handle('lingeeBridge:proxy-fetch', async (_event, url, options) => {
  if (!url || typeof url !== 'string') return { ok: false, status: 0, error: 'url is required' };
  // 仅允许 http/https
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return { ok: false, status: 0, error: 'only http/https URLs are allowed' };
  }
  try {
    const method = (options && options.method) || 'GET';
    const headers = (options && options.headers) || {};
    const body = options && options.body !== undefined ? options.body : undefined;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30 秒超时
    let resp;
    let text;
    try {
      resp = await fetch(url, { method, headers, body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined, signal: controller.signal });
      text = await resp.text();
    } finally {
      clearTimeout(timeout);
    }
    // 提取响应头子集（避免序列化整个 Headers 对象）
    const respHeaders = {};
    for (const key of ['content-type', 'x-request-id']) {
      const v = resp.headers.get(key);
      if (v) respHeaders[key] = v;
    }
    return { ok: resp.ok, status: resp.status, body: text, headers: respHeaders };
  } catch (err) {
    console.error('[LingeeBridge] proxy-fetch failed:', err.message);
    return { ok: false, status: 0, error: err.message };
  }
});

// 接收 webview 上报的业务事件
const KNOWN_BRIDGE_EVENTS = new Set(['ready', 'token-expired', 'navigation', 'error']);
ipcMain.handle('lingeeBridge:notify', (_event, eventName, data) => {
  if (!eventName || typeof eventName !== 'string') return { ok: false };

  // token-expired 事件：立即清除主进程缓存的 auth，广播到所有 webview，通知渲染进程登出
  if (eventName === 'token-expired') {
    console.warn('[LingeeBridge] token-expired received, clearing auth and triggering logout');
    currentBridgeConfig = { ...currentBridgeConfig, auth: null };
    persistBridgeConfig(); // 持久化：auth 已置 null
    broadcastToWebviews('lingeeBridge:config-changed', currentBridgeConfig);
  }

  // 转发到渲染进程（UI 层可据此响应，如 token-expired → 重新登录）
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('lingeeBridge:webview-event', eventName, data);
  }

  // navigation 事件：预留扩展点，目前仅标记为已知事件
  // if (eventName === 'navigation') { /* 标题栏由自定义 UI 管理 */ }

  return { ok: KNOWN_BRIDGE_EVENTS.has(eventName) };
});

// Client auto-update IPC handlers
ipcMain.handle('check-for-client-update', async () => {
  try {
    await autoUpdater.checkForUpdates();
    return { success: true };
  } catch (err) {
    console.error('[AutoUpdater] Check failed:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('download-client-update', async () => {
  try {
    // Windows: 清理旧的 updater 缓存，避免使用过期/损坏的文件
    if (process.platform === 'win32') {
      try {
        const cacheDir = path.join(app.getPath('userData'), '..', 'kingdee-kwork-updater', 'pending');
        if (fs.existsSync(cacheDir)) {
          const oldFiles = fs.readdirSync(cacheDir);
          for (const f of oldFiles) {
            try {
              fs.unlinkSync(path.join(cacheDir, f));
            } catch (_) { /* ignore */ }
          }
          console.log('[AutoUpdater] Cleared', oldFiles.length, 'cached files from', cacheDir);
        }
      } catch (err) {
        console.warn('[AutoUpdater] Failed to clear cache:', err.message);
      }
    }
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err) {
    console.error('[AutoUpdater] Download failed:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('install-client-update', () => {
  killSidecar();
  // macOS: 必须先设置 forceQuit，否则 close 事件拦截会阻止退出，导致窗口仅被隐藏
  forceQuit = true;

  console.log('[AutoUpdater] install-client-update called, platform:', process.platform, 'downloadedFilePath:', downloadedFilePath);
  if (process.platform === 'win32' && downloadedFilePath && downloadedFilePath.endsWith('.zip')) {
    // Windows zip 更新：electron-updater 的 NsisUpdater 无法处理 zip（它只会运行 exe 安装器）
    // 需要手动解压 zip 并用脚本替换应用文件后重启
    // Bug fix 1: 用 wscript.exe 启动脚本，避免 spawn detached 子进程随父进程退出被杀
    // Bug fix 2: 脚本内自动检测写入权限，无权限时 UAC 提权
    const appDir = path.dirname(process.execPath);
    const ps1Path = path.join(app.getPath('temp'), 'lingee-update.ps1');
    const vbsPath = path.join(app.getPath('temp'), 'lingee-update.vbs');
    const logPath = path.join(app.getPath('temp'), 'lingee-update.log');
    const script = [
      `$logFile = '${logPath.replace(/'/g, "''")}';`,
      `function Log($msg) { $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'; Add-Content -Path $logFile -Value "[$ts] $msg" }`,
      `Log 'Update script started';`,
      '',
      '# Check write permission to app directory, elevate if needed',
      `$dest = '${appDir.replace(/'/g, "''")}';`,
      `$testFile = Join-Path $dest '.update-write-test';`,
      `try { [IO.File]::WriteAllText($testFile, 'test'); Remove-Item $testFile -Force; Log 'Write permission OK' }`,
      `catch {`,
      `  Log 'No write permission, elevating with UAC...';`,
      `  Start-Process powershell -ArgumentList '-ExecutionPolicy','Bypass','-File','${ps1Path.replace(/'/g, "''")}' -Verb RunAs;`,
      `  exit 0`,
      `}`,
      '',
      '# Wait for app to exit',
      `Log 'Waiting 3 seconds for app to exit...';`,
      `Start-Sleep -Seconds 3;`,
      '',
      '# Extract zip to temp dir',
      `$zip = '${downloadedFilePath.replace(/'/g, "''")}';`,
      `Log "Zip file: $zip";`,
      `if (!(Test-Path $zip)) { Log 'ERROR: Zip file not found!'; exit 1 }`,
      `$tmp = Join-Path $env:TEMP 'lingee-update-extract';`,
      `if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force };`,
      `try { Expand-Archive -Path $zip -DestinationPath $tmp -Force; Log 'Expand-Archive succeeded' } catch { Log "ERROR Expand-Archive: $_"; exit 1 }`,
      '',
      '# Determine source dir: if zip has a single wrapper folder (no loose files), use it; otherwise use extract root',
      `$dirs = @(Get-ChildItem $tmp -Directory); $files = @(Get-ChildItem $tmp -File);`,
      `if ($dirs.Count -eq 1 -and $files.Count -eq 0) { $src = $dirs[0].FullName; Log "Detected wrapper dir: $src" } else { $src = $tmp; Log "Flat zip layout, using extract root" };`,
      `Log "Source dir: $src";`,
      `Log "Items in source: $((Get-ChildItem $src).Count)";`,
      '',
      '# Copy all files to app directory, overwriting existing',
      `Log "Destination dir: $dest";`,
      `try { Copy-Item -Path (Join-Path $src '*') -Destination $dest -Recurse -Force; Log 'Copy succeeded' } catch { Log "ERROR Copy: $_"; exit 1 }`,
      '',
      '# Clean up',
      `Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue;`,
      `Log 'Cleanup done';`,
      '',
      '# Restart app as normal user (not elevated)',
      `$appExe = Join-Path $dest '${path.basename(process.execPath)}';`,
      `Log "Restarting: $appExe";`,
      `Start-Process explorer.exe $appExe;`,
      `Log 'Update complete';`,
    ].join('\n');

    // VBScript wrapper: 用 wscript 启动 PowerShell，进程独立于 Electron 进程树
    const vbsScript = [
      'Set objShell = CreateObject("WScript.Shell")',
      `objShell.Run "powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File ""${ps1Path}""", 0, False`,
    ].join('\r\n');

    fs.writeFileSync(ps1Path, script, 'utf-8');
    fs.writeFileSync(vbsPath, vbsScript, 'utf-8');
    console.log('[AutoUpdater] Windows zip update: wrote PS1 to', ps1Path, 'VBS to', vbsPath);

    // 用 wscript.exe 启动 VBS，进程完全独立，app.exit() 后继续运行
    spawn('wscript.exe', [vbsPath], {
      detached: true,
      stdio: 'ignore',
    }).unref();

    app.exit(0);
  } else {
    // macOS: Squirrel 静默替换 .app；Windows exe: 启动 NSIS 安装程序
    autoUpdater.quitAndInstall(false, true);
  }
});

// 设置应用名称
app.name = '金蝶灵基';

// 配置自动更新
autoUpdater.setFeedURL({
  provider: 'generic',
  url: 'http://app.cosmicstudio.cn/cosmicai/lingee/update/'
});

// 开发模式下强制检查更新（仅用于测试）
autoUpdater.forceDevUpdateConfig = true;

// 禁用自动下载，我们手动控制
autoUpdater.autoDownload = false;

// 禁用退出时自动安装，由用户确认后手动触发
autoUpdater.autoInstallOnAppQuit = false;

// 自动更新事件监听
autoUpdater.on('checking-for-update', () => {
  console.log('[AutoUpdater] Checking for update...');
});

autoUpdater.on('update-available', (info) => {
  console.log('[AutoUpdater] Update available:', info.version);
  if (mainWindow) {
    mainWindow.webContents.send('client-update-available', {
      version: info.version,
      releaseNotes: info.releaseNotes
    });
  }
});

autoUpdater.on('update-not-available', () => {
  console.log('[AutoUpdater] No update available');
});

autoUpdater.on('error', (err) => {
  console.error('[AutoUpdater] Error:', err.message);
  if (mainWindow) {
    mainWindow.webContents.send('client-update-error', err.message);
  }
});

autoUpdater.on('download-progress', (progressObj) => {
  const percent = Math.round(progressObj.percent);
  const speed = (progressObj.bytesPerSecond / 1024 / 1024).toFixed(2);
  console.log(`[AutoUpdater] Download progress: ${percent}% (${speed} MB/s)`);
  if (mainWindow) {
    mainWindow.webContents.send('client-download-progress', {
      percent,
      speed,
      transferred: progressObj.transferred,
      total: progressObj.total
    });
  }
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('[AutoUpdater] Update downloaded:', info.version);
  console.log('[AutoUpdater] Event info keys:', Object.keys(info).join(', '));
  // 保存下载的文件路径，Windows zip 更新需要用到
  if (info.downloadedFile) {
    downloadedFilePath = info.downloadedFile;
    console.log('[AutoUpdater] Downloaded file (from event):', downloadedFilePath);
  } else if (process.platform === 'win32') {
    // 回退：扫描 updater 缓存目录查找 zip 文件
    try {
      const cacheDir = path.join(app.getPath('userData'), '..', 'kingdee-kwork-updater', 'pending');
      console.log('[AutoUpdater] Scanning cache dir:', cacheDir);
      if (fs.existsSync(cacheDir)) {
        const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.zip'));
        console.log('[AutoUpdater] Found zip files:', files);
        if (files.length > 0) {
          // 取最新的 zip 文件
          const sorted = files.map(f => ({
            name: f,
            time: fs.statSync(path.join(cacheDir, f)).mtimeMs
          })).sort((a, b) => b.time - a.time);
          downloadedFilePath = path.join(cacheDir, sorted[0].name);
          console.log('[AutoUpdater] Downloaded file (from scan):', downloadedFilePath);
        }
      }
    } catch (err) {
      console.error('[AutoUpdater] Failed to scan cache dir:', err.message);
    }
  }
  if (mainWindow) {
    mainWindow.webContents.send('client-update-downloaded');
  }
});

// 强制 Chromium 使用亮色模式，影响 webview 中 prefers-color-scheme 媒体查询
// 主窗口使用硬编码暗色样式，不受此设置影响
nativeTheme.themeSource = 'light';

// 为 kcode-web webview 注入 preload，使其内部页面可调用 lingeeBridge（如 selectFolder）
// 仅对 localhost 来源的 webview 注入，避免外部页面获得桥接能力
app.on('web-contents-created', (_, contents) => {
  contents.on('will-attach-webview', (_event, webPreferences, params) => {
    const src = params.src || '';
    // 仅对可信来源注入 preload：localhost / 127.0.0.1 / 内网 IP
    const trustedPrefixes = ['http://localhost', 'http://127.0.0.1', 'http://172.20.', LINGEE_BASE_URL, 'https://kworkdev.kingdee.com'];
    if (!trustedPrefixes.some(prefix => src.startsWith(prefix))) return;
    webPreferences.preload = path.join(__dirname, 'webview-preload.cjs');
    webPreferences.contextIsolation = true;
    webPreferences.nodeIntegration = false;
  });
});

// Forward install progress events to renderer
installEvents.on('progress', (data) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('opencode-install-progress', data);
  }
});

/* ── Opencode Background Update Timer ── */
const OPENCODE_BG_CHECK_DELAY = 1 * 60 * 1000;    // 首次延迟 1 分钟
const OPENCODE_BG_CHECK_INTERVAL = 30 * 60 * 1000; // 之后每 30 分钟
let bgCheckTimer = null;
let bgCheckInterval = null;

function startOpencodeBackgroundCheck() {
  if (bgCheckTimer) return; // already started
  console.log('[Main] Scheduling opencode background update check: delay=' + OPENCODE_BG_CHECK_DELAY + 'ms, interval=' + OPENCODE_BG_CHECK_INTERVAL + 'ms');

  const doCheck = async () => {
    try {
      const result = await backgroundUpdateCheck();
      if (result.hasUpdate && result.version && mainWindow && !mainWindow.isDestroyed()) {
        console.log('[Main] Opencode update ready, notifying renderer: v' + result.version);
        mainWindow.webContents.send('opencode-update-ready', { version: result.version });
      }
    } catch (err) {
      console.error('[Main] Background update check error:', err.message);
    }
  };

  bgCheckTimer = setTimeout(() => {
    doCheck();
    bgCheckInterval = setInterval(doCheck, OPENCODE_BG_CHECK_INTERVAL);
  }, OPENCODE_BG_CHECK_DELAY);
}

function stopOpencodeBackgroundCheck() {
  if (bgCheckTimer) { clearTimeout(bgCheckTimer); bgCheckTimer = null; }
  if (bgCheckInterval) { clearInterval(bgCheckInterval); bgCheckInterval = null; }
}

app.whenReady().then(async () => {
  // Pre-resolve login-shell environment early (macOS GUI apps lack full PATH)
  resolveShellEnv().catch(() => {});

  // 初始化 bridge config 的 hostVersion
  currentBridgeConfig.hostVersion = app.getVersion();

  // Start opencode background update checker
  startOpencodeBackgroundCheck();

  // 自定义菜单，使 macOS 菜单栏显示正确的应用名称（必须在 app ready 之后）
  const appName = '金蝶灵基';
  if (process.platform === 'darwin') {
    const locale = app.getLocale(); // e.g. 'zh-CN', 'en-US'
    const isChinese = locale.startsWith('zh');
    const i18n = isChinese
      ? { about: `关于 ${appName}`, hide: `隐藏 ${appName}`, hideOthers: '隐藏其他', unhide: '显示全部', quit: `退出 ${appName}`, services: '服务', file: '文件', edit: '编辑', view: '视图', window: '窗口' }
      : { about: `About ${appName}`, hide: `Hide ${appName}`, hideOthers: 'Hide Others', unhide: 'Show All', quit: `Quit ${appName}`, services: 'Services', file: 'File', edit: 'Edit', view: 'View', window: 'Window' };
    const template = [
      {
        label: appName,
        submenu: [
          { label: i18n.about, click: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('show-about'); } },
          { type: 'separator' },
          { role: 'services', label: i18n.services },
          { type: 'separator' },
          { role: 'hide', label: i18n.hide },
          { role: 'hideOthers', label: i18n.hideOthers },
          { role: 'unhide', label: i18n.unhide },
          { type: 'separator' },
          { role: 'quit', label: i18n.quit },
        ],
      },
      {
        label: i18n.file,
        submenu: [
          { role: 'close', label: isChinese ? '关闭窗口' : 'Close Window' },
        ],
      },
      {
        label: i18n.edit,
        submenu: [
          { role: 'undo', label: isChinese ? '撤销' : 'Undo' },
          { role: 'redo', label: isChinese ? '重做' : 'Redo' },
          { type: 'separator' },
          { role: 'cut', label: isChinese ? '剪切' : 'Cut' },
          { role: 'copy', label: isChinese ? '拷贝' : 'Copy' },
          { role: 'paste', label: isChinese ? '粘贴' : 'Paste' },
          { role: 'selectAll', label: isChinese ? '全选' : 'Select All' },
        ],
      },
      {
        label: i18n.view,
        submenu: [
          { role: 'reload', label: isChinese ? '重新加载' : 'Reload' },
          { role: 'forceReload', label: isChinese ? '强制重新加载' : 'Force Reload' },
          { role: 'toggleDevTools', label: isChinese ? '开发者工具' : 'Toggle Developer Tools' },
          { type: 'separator' },
          { role: 'resetZoom', label: isChinese ? '实际大小' : 'Actual Size' },
          { role: 'zoomIn', label: isChinese ? '放大' : 'Zoom In' },
          { role: 'zoomOut', label: isChinese ? '缩小' : 'Zoom Out' },
          { type: 'separator' },
          { role: 'togglefullscreen', label: isChinese ? '进入全屏幕' : 'Toggle Full Screen' },
        ],
      },
      {
        label: i18n.window,
        submenu: [
          { role: 'minimize', label: isChinese ? '最小化' : 'Minimize' },
          { role: 'zoom', label: isChinese ? '缩放' : 'Zoom' },
          { type: 'separator' },
          { role: 'front', label: isChinese ? '前置全部窗口' : 'Bring All to Front' },
        ],
      },
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
  stopOpencodeBackgroundCheck();
  // 向所有 webview 发送停止信号，允许被嵌套端执行优雅退出
  broadcastToWebviews('lingeeBridge:stop-requested');
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
