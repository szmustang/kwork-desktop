// ===== OAuth2 登录流程核心模块 =====
// 职责：获取 OAuth2 配置 → BrowserWindow 打开授权页 → onBeforeRequest 拦截回调 → 换 token

const https = require('https');
const { URL } = require('url');
const { BrowserWindow, session } = require('electron');
const { LINGEE_BASE_URL } = require('./constants.cjs');

const OAUTH2_BASE_URL = LINGEE_BASE_URL;
const OAUTH2_TIMEOUT = 5 * 60 * 1000; // 5 分钟超时

// 模块级防重复点击
let pendingLogin = null;

/**
 * 发起 HTTPS GET 请求（Promise 化）
 */
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`GET ${url} failed with status ${res.statusCode}: ${data}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`GET ${url} returned invalid JSON: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', (err) => reject(new Error(`GET ${url} network error: ${err.message}`)));
    req.setTimeout(30000, () => { req.destroy(); reject(new Error(`GET ${url} timed out`)); });
  });
}

/**
 * 发起 HTTPS POST 请求（Promise 化）
 */
function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const postData = JSON.stringify(body);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = new Error(`POST ${url} failed with status ${res.statusCode}: ${data}`);
          // 尝试解析响应体，保留结构化错误信息
          try { err.body = JSON.parse(data); } catch (_) {}
          reject(err);
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`POST ${url} returned invalid JSON: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', (err) => reject(new Error(`POST ${url} network error: ${err.message}`)));
    req.setTimeout(30000, () => { req.destroy(); reject(new Error(`POST ${url} timed out`)); });
    req.write(postData);
    req.end();
  });
}

/**
 * 创建带 code 属性的 Error
 */
function createError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * 启动 OAuth2 登录流程
 *
 * @returns {Promise<Object>} LoginResponse（token, userId, displayName 等）
 * @throws {Error} 携带 code 属性：'TIMEOUT' | 'CANCELLED' | 'FAILED'
 */
async function startOAuth2Login() {
  // 防重复点击：正在进行中的流程直接返回同一 Promise
  if (pendingLogin) {
    return pendingLogin;
  }

  pendingLogin = _doOAuth2Login();
  try {
    return await pendingLogin;
  } finally {
    pendingLogin = null;
  }
}

async function _doOAuth2Login() {
  // ========== Step 1: 获取 OAuth2 配置 ==========
  let config;
  try {
    config = await httpsGet(`${OAUTH2_BASE_URL}/openwork/auth/oauth2/config`);
  } catch (err) {
    throw createError(`获取 OAuth2 配置失败: ${err.message}`, 'FAILED');
  }

  if (!config || !config.authorizationUri || !config.state || !config.clientId || !config.redirectUri) {
    throw createError('OAuth2 配置缺少必要字段 (authorizationUri / state / clientId / redirectUri)', 'FAILED');
  }

  const expectedState = config.state;
  const registeredRedirectUri = config.redirectUri; // 后端注册的回调地址

  // ========== Step 2: 拼接授权 URL ==========
  const authorizeUrl = new URL(config.authorizationUri);
  authorizeUrl.searchParams.set('client_id', config.clientId);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('redirect_uri', registeredRedirectUri);
  authorizeUrl.searchParams.set('state', expectedState);

  // ========== Step 3: 创建独立 session（隔离 cookie，不影响主窗口） ==========
  const partition = `oauth2-${Date.now()}`;
  const oauthSession = session.fromPartition(partition, { cache: false });

  // 登录流程结束后清理 session 存储，避免多次登录产生孤立分区内存泄漏
  const clearSession = () => {
    try { oauthSession.clearStorageData(); } catch (_) {}
  };

  // ========== Step 4: 注册 onBeforeRequest 拦截回调 ==========
  const callbackResult = await new Promise((resolve, reject) => {
    let handled = false;
    let authWindow = null;
    let timer = null;

    // 清理函数：确保窗口、定时器、拦截器、session 都被释放
    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      // 移除拦截器
      try { oauthSession.webRequest.onBeforeRequest(null); } catch (_) {}
      // 关闭窗口
      if (authWindow && !authWindow.isDestroyed()) {
        authWindow.close();
        authWindow = null;
      }
      // 清理 session 存储
      clearSession();
    };

    // 超时处理
    timer = setTimeout(() => {
      if (handled) return;
      handled = true;
      cleanup();
      reject(createError('OAuth2 登录超时，请重试', 'TIMEOUT'));
    }, OAUTH2_TIMEOUT);

    // 网络层拦截：匹配 redirectUri 前缀的请求
    oauthSession.webRequest.onBeforeRequest(
      { urls: [`${registeredRedirectUri}*`] },
      (details, callback) => {
        if (handled) {
          callback({ cancel: true });
          return;
        }
        handled = true;

        // 取消请求（不让浏览器真正访问回调地址）
        callback({ cancel: true });

        try {
          const callbackUrl = new URL(details.url);

          // 检查 OAuth2 错误回调（用户拒绝授权等）
          const errorParam = callbackUrl.searchParams.get('error');
          if (errorParam) {
            const errorDesc = callbackUrl.searchParams.get('error_description') || errorParam;
            cleanup();
            reject(createError(`授权被拒绝: ${errorDesc}`, 'CANCELLED'));
            return;
          }

          // 校验 state
          const callbackState = callbackUrl.searchParams.get('state');
          if (callbackState !== expectedState) {
            cleanup();
            reject(createError('OAuth2 state 校验失败，可能存在安全风险', 'FAILED'));
            return;
          }

          // 校验 code
          const code = callbackUrl.searchParams.get('code');
          if (!code) {
            cleanup();
            reject(createError('回调缺少 code 参数', 'FAILED'));
            return;
          }

          // 成功：提取 code + state
          cleanup();
          resolve({ code, state: callbackState });
        } catch (parseErr) {
          cleanup();
          reject(createError(`回调 URL 解析异常: ${parseErr.message}`, 'FAILED'));
        }
      }
    );

    // ========== Step 5: 打开 BrowserWindow ==========
    authWindow = new BrowserWindow({
      width: 800,
      height: 680,
      show: true,
      center: true,
      autoHideMenuBar: true,
      title: '金蝶云账号登录',
      webPreferences: {
        session: oauthSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    // 隐藏菜单栏
    authWindow.setMenuBarVisibility(false);

    // 安全限制：仅阻止非 HTTPS 且非授权域名的导航（允许 OAuth2 流程中的合法跳转）
    authWindow.webContents.on('will-navigate', (event, url) => {
      try {
        const target = new URL(url);
        // 允许 HTTPS 协议（OAuth2 流程可能涉及多个子域名/第三方登录）
        // 仅阻止非安全协议（http 除 localhost 外、file、data 等）
        if (target.protocol !== 'https:') {
          console.warn(`[OAuth2] Blocked non-HTTPS navigation: ${url}`);
          event.preventDefault();
        }
      } catch (_) {
        event.preventDefault();
      }
    });

    // 用户手动关闭窗口 = 取消登录
    authWindow.on('closed', () => {
      authWindow = null;
      if (!handled) {
        handled = true;
        if (timer) { clearTimeout(timer); timer = null; }
        try { oauthSession.webRequest.onBeforeRequest(null); } catch (_) {}
        clearSession(); // 用户关闭窗口也需要清理 session 分区
        reject(createError('用户取消了登录', 'CANCELLED'));
      }
    });

    // 加载授权页面
    authWindow.loadURL(authorizeUrl.toString());
    console.log(`[OAuth2] Auth window opened: ${authorizeUrl.toString()}`);
  });

  // ========== Step 6: 用 code 换 token ==========
  let loginResult;
  try {
    loginResult = await httpsPost(`${OAUTH2_BASE_URL}/openwork/auth/oauth2/login`, {
      code: callbackResult.code,
      state: callbackResult.state,
    });
  } catch (err) {
    // 优先使用后端返回的 error_message
    let backendMsg = err.body?.error_message;
    if (!backendMsg) {
      // 兜底：从错误信息中解析 JSON body
      const match = err.message && err.message.match(/\{[\s\S]*\}/);
      if (match) {
        try { backendMsg = JSON.parse(match[0]).error_message; } catch (_) {}
      }
    }
    throw createError(backendMsg || 'OAuth2 登录失败', 'FAILED');
  }

  if (!loginResult || !loginResult.ok) {
    const errMsg = loginResult?.error_message || 'OAuth2 登录失败';
    throw createError(errMsg, 'FAILED');
  }

  // ========== Step 7: 返回 LoginResponse ==========
  return loginResult;
}

module.exports = { startOAuth2Login };
