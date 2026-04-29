const { app, BrowserWindow, ipcMain, nativeTheme, Menu, nativeImage, dialog, shell, clipboard, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { autoUpdater } = require('electron-updater');
const { startSidecar, killSidecar, getServerInfo, isOpencodeInstalled, checkOpencodeInstalled, backgroundUpdateCheck, getOpencodeVersion, checkPendingUpdate, installOpencode, getInstallState, installEvents, resolveShellEnv } = require('./sidecar.cjs');
const { startOAuth2Login } = require('./oauth2.cjs');
const { LINGEE_BASE_URL } = require('./constants.cjs');
const tracking = require('./tracking.cjs');
const devServerURL = process.env.VITE_DEV_SERVER_URL;

// 禁止 macOS 恢复上次窗口状态（最小化/隐藏记忆），这是打包后窗口不弹出的根本原因
app.commandLine.appendSwitch('disable-features', 'WidgetLayering');
app.commandLine.appendSwitch('disable-mac-app-state-restoration');

let mainWindow = null;

/* ── Client Update File Logger ── */
const os = require('os');
const CLIENT_UPDATE_LOG_DIR = path.join(os.homedir(), '.kcode', 'updates');
const CLIENT_UPDATE_LOG_PATH = path.join(CLIENT_UPDATE_LOG_DIR, 'lingee-desktop-update.log');
const CLIENT_UPDATE_LOG_MAX_SIZE = 1 * 1024 * 1024; // 1MB

function clientUpdateLog(level, ...args) {
  const now = new Date();
  const ts = now.toLocaleString('zh-CN', { hour12: false }) + '.' + String(now.getMilliseconds()).padStart(3, '0');
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  const line = `[${ts}] [${level}] ${msg}\n`;
  // Console
  if (level === 'ERROR') console.error('[AutoUpdater]', ...args);
  else console.log('[AutoUpdater]', ...args);
  // File
  try {
    fs.mkdirSync(CLIENT_UPDATE_LOG_DIR, { recursive: true });
    try {
      const stat = fs.statSync(CLIENT_UPDATE_LOG_PATH);
      if (stat.size > CLIENT_UPDATE_LOG_MAX_SIZE) {
        const content = fs.readFileSync(CLIENT_UPDATE_LOG_PATH, 'utf-8');
        const halfPoint = content.indexOf('\n', Math.floor(content.length / 2));
        fs.writeFileSync(CLIENT_UPDATE_LOG_PATH, content.slice(halfPoint + 1), 'utf-8');
      }
    } catch (_) { /* file may not exist yet */ }
    fs.appendFileSync(CLIENT_UPDATE_LOG_PATH, line, 'utf-8');
  } catch (_) { /* best effort */ }
}
let forceQuit = false;

// baseUrl 变更后需要清除渲染进程 localStorage（须等 app ready 后执行）
let needClearRendererStorage = false;

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
      baseUrl: LINGEE_BASE_URL,
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

    // baseUrl 变更检测：环境切换或旧版本升级时自动清除旧 auth，避免旧 token 在新环境上报错
    // data.baseUrl 为 undefined（旧版本无此字段）或与当前不同，均视为环境变更
    if (data.baseUrl !== LINGEE_BASE_URL) {
      console.warn(`[BridgePersist] baseUrl changed: ${data.baseUrl || '(none)'} → ${LINGEE_BASE_URL}, clearing auth`);
      currentBridgeConfig.auth = null;
      needClearRendererStorage = true;
      // 立即持久化：写入新 baseUrl 并清除 auth
      persistBridgeConfig();
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
  const isMac = process.platform === 'darwin';

  // 用屏幕工作区尺寸减去外边距来初始化浮动窗口，避免被系统标记为最大化
  // 状态（最大化会触发 macOS 的 rounded=false，使 48px 圆角丢失）。
  const { screen } = require('electron');
  const workArea = screen.getPrimaryDisplay().workArea;
  const isMacPlatform = process.platform === 'darwin';
  // macOS 下为浮动窗口留出四周边距，四角圆角才能完整曝露；Windows 按旧行为充满工作区。
  const margin = isMacPlatform ? 80 : 0;
  const initialWidth = Math.max(900, workArea.width - margin * 2);
  const initialHeight = Math.max(600, workArea.height - margin * 2);

  mainWindow = new BrowserWindow({
    title: '',
    width: initialWidth,
    height: initialHeight,
    x: workArea.x + Math.floor((workArea.width - initialWidth) / 2),
    y: workArea.y + Math.floor((workArea.height - initialHeight) / 2),
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hidden',
    titleBarOverlay: isWin ? { color: '#00000000', symbolColor: '#666666', height: 40 } : undefined,
    trafficLightPosition: { x: 12, y: 12 },
    // macOS 开启透明窗口，配合渲染层的 border-radius 实现整窗自定义圆角（仅在非最大化/非全屏状态下有效）。
    // Windows 继续使用不透明的矩形窗口，保留系统 Aero 阴影与传统外观。
    transparent: isMac,
    // macOS 下关闭 NSWindow 系统阴影：系统阴影按矩形 frame 绘制，
    // 会在 CSS 圆角外的四角曝光为白色 L 形块。阴影改由 CSS box-shadow
    // 在 .app 上绘制，始终沿圆角轮廓。Windows 保留系统 Aero 阴影。
    hasShadow: !isMac,
    backgroundColor: isMac ? '#00000000' : '#ffffff',
    show: false, // 延迟显示窗口，避免启动白屏闪烁
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      webSecurity: false,
    },
  });

  // 页面加载完成后显示窗口。
  // macOS 保持浮动窗口、不自动最大化，保证整窗 48px 圆角始终可见；
  // Windows 维持原行为即启动即最大化。
  let windowShown = false;
  const showWindow = () => {
    if (windowShown || !mainWindow || mainWindow.isDestroyed()) return;
    windowShown = true;
    if (!isMacPlatform) {
      mainWindow.maximize();
    }
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

  // 窗口恢复显示时，主动检查 token 是否已过期
  // 解决 macOS hide→show 后 token 过期但界面不跳登录页的问题
  mainWindow.on('show', () => {
    if (currentBridgeConfig.auth && currentBridgeConfig.auth.expiresAt) {
      if (Date.now() >= currentBridgeConfig.auth.expiresAt) {
        console.warn('[Main] Token expired on window show, clearing auth and notifying renderer');
        currentBridgeConfig = { ...currentBridgeConfig, auth: null };
        persistBridgeConfig();
        broadcastToWebviews('lingeeBridge:config-changed', currentBridgeConfig);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('lingeeBridge:webview-event', 'token-expired', {});
        }
      }
    }
  });

  // 向渲染进程广播窗口的全屏状态变化，供前端按需切换整窗圆角。
  // 注意：MacPaw 类 “无边际圆角” 视觉规范下，最大化仍保留圆角，仅全屏时恢复直角。
  const sendMaxState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const rounded = !mainWindow.isFullScreen();
    mainWindow.webContents.send('window-rounded-state', rounded);
  };
  mainWindow.on('maximize', sendMaxState);
  mainWindow.on('unmaximize', sendMaxState);
  mainWindow.on('enter-full-screen', sendMaxState);
  mainWindow.on('leave-full-screen', sendMaxState);
  mainWindow.webContents.on('did-finish-load', sendMaxState);

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

// 渲染进程查询当前窗口是否处于可圆角状态（仅全屏时恢复直角）。
ipcMain.handle('get-window-rounded-state', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  return !mainWindow.isFullScreen();
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

// ── HMAC-SHA256 签名（密钥仅在主进程，不暴露给渲染进程和 webview） ──
const MANAGE_HMAC_KEY = '74b5f6bcbe4b47d84bdee02110050040';

/** 构建待签名字符串：query 参数按 key 字典序 + timestamp */
function buildHmacSignString(params, timestamp) {
  const sortedKeys = Object.keys(params).sort();
  const paramStr = sortedKeys.map(k => `${k}=${params[k]}`).join('&');
  return paramStr ? `${paramStr}&timestamp=${timestamp}` : `timestamp=${timestamp}`;
}

ipcMain.handle('lingeeBridge:fetch-user-profile', async (event, userId) => {
  // 仅接受主窗口渲染进程的请求，拒绝 webview 侧调用
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    return { ok: false, status: 0, error: 'unauthorized sender' };
  }
  if (!userId || typeof userId !== 'string') {
    return { ok: false, status: 0, error: 'userId is required' };
  }
  const url = `${LINGEE_BASE_URL}/manage/api/users/backend/${encodeURIComponent(userId)}`;
  const timestamp = String(Date.now());
  const signString = `timestamp=${timestamp}`;
  const sign = crypto.createHmac('sha256', MANAGE_HMAC_KEY).update(signString).digest('hex');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let resp, text;
    try {
      resp = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Manage-Sign': sign,
          'X-Manage-Timestamp': timestamp,
        },
        signal: controller.signal,
      });
      text = await resp.text();
    } finally {
      clearTimeout(timeout);
    }

    if (!resp.ok) {
      return { ok: false, status: resp.status, error: `HTTP ${resp.status}` };
    }

    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return { ok: false, status: resp.status, error: `Unexpected content-type: ${contentType}` };
    }

    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      return { ok: false, status: resp.status, error: 'Invalid JSON response' };
    }

    // 兼容包装格式：{ code: 0, data: { ... } }
    if (raw && typeof raw === 'object' && 'data' in raw && typeof raw.data === 'object' && raw.data !== null && !('id' in raw)) {
      return { ok: true, status: resp.status, data: raw.data };
    }
    return { ok: true, status: resp.status, data: raw };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
});

// ── 开发环境配置 API（HMAC-SHA256 签名在主进程完成，密钥不暴露给 webview） ──
const DEV_ENV_BASE_URL = `${LINGEE_BASE_URL}/manage/api/dev-environments/backend`;

ipcMain.handle('lingeeBridge:dev-env-fetch', async (_event, opts) => {
  if (!opts || typeof opts.path !== 'string') {
    return { ok: false, status: 0, error: 'path is required' };
  }

  // Build query params (filter out undefined/null/empty)
  const queryParams = (opts.queryParams && typeof opts.queryParams === 'object') ? opts.queryParams : {};
  const cleanParams = {};
  for (const [key, value] of Object.entries(queryParams)) {
    if (value !== undefined && value !== null && value !== '') {
      cleanParams[key] = String(value);
    }
  }

  // Build full URL
  let url = `${DEV_ENV_BASE_URL}${opts.path}`;
  if (Object.keys(cleanParams).length > 0) {
    const qs = new URLSearchParams(cleanParams).toString();
    url = `${url}?${qs}`;
  }

  // HMAC-SHA256 signing
  const timestamp = String(Date.now());
  const signString = buildHmacSignString(cleanParams, timestamp);
  const sign = crypto.createHmac('sha256', MANAGE_HMAC_KEY).update(signString).digest('hex');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let resp, text;
    try {
      resp = await fetch(url, {
        method: 'GET',
        headers: {
          'X-Manage-Sign': sign,
          'X-Manage-Timestamp': timestamp,
        },
        signal: controller.signal,
      });
      text = await resp.text();
    } finally {
      clearTimeout(timeout);
    }
    const respHeaders = {};
    for (const key of ['content-type', 'x-request-id']) {
      const v = resp.headers.get(key);
      if (v) respHeaders[key] = v;
    }
    return { ok: resp.ok, status: resp.status, body: text, headers: respHeaders };
  } catch (err) {
    console.error('[LingeeBridge] dev-env-fetch failed:', err.message);
    return { ok: false, status: 0, error: err.message };
  }
});

// ── 已签名的后端 API 代理（HMAC 在主进程完成，密钥不出主进程） ──
ipcMain.handle('lingeeBridge:signed-backend-fetch', async (_event, url, options) => {
  if (typeof url !== 'string' || !url) {
    return { ok: false, status: 0, error: 'url is required' };
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    return { ok: false, status: 0, error: `invalid url: ${err.message}` };
  }

  // 收集 query 参数，按 key 字典序去重（多值取第一个），与前端原签名逻辑等价
  const queryParams = {};
  const seen = new Set();
  for (const k of Array.from(parsed.searchParams.keys()).sort()) {
    if (seen.has(k)) continue;
    seen.add(k);
    queryParams[k] = parsed.searchParams.get(k) ?? '';
  }

  const timestamp = String(Date.now());
  const signString = buildHmacSignString(queryParams, timestamp);
  const sign = crypto.createHmac('sha256', MANAGE_HMAC_KEY).update(signString).digest('hex');

  const method = (options && options.method) || 'GET';
  const body = options && options.body;
  const incomingHeaders = (options && options.headers) || {};
  const headers = {
    ...incomingHeaders,
    'X-Manage-Sign': sign,
    'X-Manage-Timestamp': timestamp,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    let resp, text;
    try {
      resp = await fetch(url, { method, headers, body, signal: controller.signal });
      text = await resp.text();
    } finally {
      clearTimeout(timeout);
    }
    const respHeaders = {};
    for (const key of ['content-type', 'x-request-id']) {
      const v = resp.headers.get(key);
      if (v) respHeaders[key] = v;
    }
    return { ok: resp.ok, status: resp.status, body: text, headers: respHeaders };
  } catch (err) {
    console.error('[LingeeBridge] signed-backend-fetch failed:', err.message);
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

ipcMain.handle('tracking:send-event', async (_event, eventData) => {
  try {
    const result = await tracking.sendTrackingEvent(eventData)
    return result
  } catch (err) {
    console.error('[Tracking] send failed:', err)
    return { success: false, error: err.message || String(err) }
  }
})

ipcMain.handle('install-client-update', () => {
  killSidecar();
  // macOS: 必须先设置 forceQuit，否则 close 事件拦截会阻止退出，导致窗口仅被隐藏
  forceQuit = true;

  clientUpdateLog('INFO', 'install-client-update called, platform:', process.platform);
  // macOS: Squirrel 静默替换 .app
  // Windows: NSIS 静默安装（isSilent=true 无安装界面, isForceRunAfter=true 安装完自动重启）
  autoUpdater.quitAndInstall(true, true);
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

// 禁用自动下载，由 update-available 事件手动触发静默下载
autoUpdater.autoDownload = false;

// 退出时自动安装已下载的更新包，用户跳过后下次启动即为新版本
autoUpdater.autoInstallOnAppQuit = true;

// 自动更新事件监听
autoUpdater.on('checking-for-update', () => {
  clientUpdateLog('INFO', 'Checking for update...');
});

autoUpdater.on('update-available', (info) => {
  clientUpdateLog('INFO', 'Update available:', info.version, '— starting silent background download');
  // 不通知前端，静默后台下载；下载完成后由 update-downloaded 事件通知
  // Windows: 清理旧的 updater 缓存，避免使用过期/损坏的文件
  if (process.platform === 'win32') {
    try {
      const cacheDir = path.join(app.getPath('userData'), '..', 'kingdee-kwork-updater', 'pending');
      if (fs.existsSync(cacheDir)) {
        const oldFiles = fs.readdirSync(cacheDir);
        for (const f of oldFiles) {
          try { fs.unlinkSync(path.join(cacheDir, f)); } catch (_) { /* ignore */ }
        }
        clientUpdateLog('INFO', 'Cleared', oldFiles.length, 'cached files from', cacheDir);
      }
    } catch (err) {
      clientUpdateLog('WARN', 'Failed to clear cache:', err.message);
    }
  }
  autoUpdater.downloadUpdate().catch((err) => {
    clientUpdateLog('ERROR', 'Silent download failed:', err.message);
  });
});

autoUpdater.on('update-not-available', () => {
  clientUpdateLog('INFO', 'No update available');
});

autoUpdater.on('error', (err) => {
  clientUpdateLog('ERROR', 'Error:', err.message);
  // 后台静默下载模式下，错误仅记录日志，不通知前端；下一轮定时检查会重试
});

autoUpdater.on('download-progress', (progressObj) => {
  const percent = Math.round(progressObj.percent);
  const speed = (progressObj.bytesPerSecond / 1024 / 1024).toFixed(2);
  clientUpdateLog('INFO', `Download progress: ${percent}% (${speed} MB/s)`);
  // 后台静默下载，不发送进度到前端
});

autoUpdater.on('update-downloaded', (info) => {
  clientUpdateLog('INFO', 'Update downloaded:', info.version);
  // 下载完成，通知前端显示更新提示（附带版本号）
  if (mainWindow) {
    mainWindow.webContents.send('client-update-downloaded', {
      version: info.version
    });
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

/* ── Client Background Update Timer ── */
const CLIENT_BG_CHECK_DELAY = 1 * 60 * 1000;      // 首次延迟 1 分钟
const CLIENT_BG_CHECK_INTERVAL = 60 * 60 * 1000;   // 之后每 1 小时
let clientCheckTimer = null;
let clientCheckInterval = null;

function startClientBackgroundCheck() {
  if (clientCheckTimer) return;
  console.log('[Main] Scheduling client background update check: delay=' + CLIENT_BG_CHECK_DELAY + 'ms, interval=' + CLIENT_BG_CHECK_INTERVAL + 'ms');

  const doCheck = async () => {
    try {
      clientUpdateLog('INFO', 'Background check triggered');
      await autoUpdater.checkForUpdates();
    } catch (err) {
      clientUpdateLog('ERROR', 'Background check failed:', err.message);
    }
  };

  clientCheckTimer = setTimeout(() => {
    doCheck();
    clientCheckInterval = setInterval(doCheck, CLIENT_BG_CHECK_INTERVAL);
  }, CLIENT_BG_CHECK_DELAY);
}

function stopClientBackgroundCheck() {
  if (clientCheckTimer) { clearTimeout(clientCheckTimer); clientCheckTimer = null; }
  if (clientCheckInterval) { clearInterval(clientCheckInterval); clientCheckInterval = null; }
}

app.whenReady().then(async () => {
  // Pre-resolve login-shell environment early (macOS GUI apps lack full PATH)
  resolveShellEnv().catch(() => {});

  // baseUrl 变更时清除渲染进程 localStorage（session API 须在 app ready 后调用）
  if (needClearRendererStorage) {
    try {
      const { session } = require('electron');
      await session.defaultSession.clearStorageData({ storages: ['localstorage'] });
      console.log('[BridgePersist] Renderer localStorage cleared due to baseUrl change');
    } catch (err) {
      console.warn('[BridgePersist] Failed to clear renderer storage:', err.message);
    }
    needClearRendererStorage = false;
  }

  // 初始化 bridge config 的 hostVersion
  currentBridgeConfig.hostVersion = app.getVersion();

  // Start background update checkers
  startOpencodeBackgroundCheck();
  startClientBackgroundCheck();

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

  // 启动时补传上次失败的埋点缓存
  tracking.flushCachedEvents().catch(err => {
    console.error('[Tracking] flush cache failed:', err)
  })
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
  stopClientBackgroundCheck();
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
