/**
 * 埋点核心模块
 *
 * 负责事件签名、设备信息采集、载荷构建、发送与本地缓存。
 * 所有常量从 constants.cjs 统一引入，禁止硬编码。
 */
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const {
  TRACKING_API_URL,
  TRACKING_SECRET_KEY,
  TRACKING_CLIENT_ID,
  TRACKING_PROJECT,
  TRACKING_STORE,
  TRACKING_MAX_RETRY,
} = require('./constants.cjs');

// ── 签名计算 ──

/**
 * 按苍穹文档生成 HMAC-SHA256 签名
 * @param {string} timestamp
 * @param {string} nonce
 * @returns {string} base64 签名
 */
function generateSignature(timestamp, nonce) {
  const srcStr = `POST\n%2Fladdercs%2Fladderlog\nproject=${TRACKING_PROJECT}&store=${TRACKING_STORE}\nx-api-nonce:${nonce}\nx-api-timestamp:${timestamp}\n`;
  const hmacHex = crypto.createHmac('sha256', TRACKING_SECRET_KEY).update(srcStr).digest('hex');
  return Buffer.from(hmacHex, 'utf-8').toString('base64');
}

// ── 设备信息采集 ──

const KCODE_DIR = path.join(os.homedir(), '.kcode');
const DEVICE_ID_PATH = path.join(KCODE_DIR, 'device-id');

/**
 * 获取持久化设备 ID，不存在则生成并写入 ~/.kcode/device-id
 * @returns {string}
 */
function getDeviceId() {
  try {
    return fs.readFileSync(DEVICE_ID_PATH, 'utf-8').trim();
  } catch (_) {
    const id = crypto.randomUUID();
    try {
      fs.mkdirSync(KCODE_DIR, { recursive: true });
      fs.writeFileSync(DEVICE_ID_PATH, id, 'utf-8');
    } catch (err) {
      console.error('[Tracking] write device-id failed:', err.message);
    }
    return id;
  }
}

/**
 * 获取操作系统信息
 * @returns {{ os: string, os_version: string, os_arch: string }}
 */
function getOsInfo() {
  const platform = os.platform();
  let osName;
  if (platform === 'darwin') osName = 'mac';
  else if (platform === 'win32') osName = 'windows';
  else osName = 'linux';

  let osVersion;
  if (platform === 'darwin') {
    // os.release() returns Darwin kernel version, e.g. '23.4.0' → macOS 14.4
    osVersion = `macOS ${os.release()}`;
  } else {
    osVersion = `${os.type()} ${os.release()}`;
  }

  return { os: osName, os_version: osVersion, os_arch: os.arch() };
}

/**
 * @returns {string} 应用版本号
 */
function getAppVersion() {
  return app.getVersion();
}

/**
 * @returns {string} 代码版本号（一阶段与 app_version 相同）
 */
function getCodeVersion() {
  return app.getVersion();
}

// ── 哈希 ──

/**
 * SHA-256 哈希
 * @param {*} value
 * @returns {string}
 */
function hashField(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

// ── 构建载荷 ──

/**
 * 合并渲染进程传入的事件数据与主进程采集的设备信息，构建最终上报载荷
 * @param {object} eventData - 包含 event_name, event_time, user_id, tenant_id, var
 * @returns {object}
 */
function buildPayload(eventData) {
  const osInfo = getOsInfo();
  const deviceId = getDeviceId();

  const payload = {
    event_name: eventData.event_name,
    event_time: eventData.event_time,
    user_id: hashField(eventData.user_id || ''),
    tenant_id: eventData.tenant_id || '',
    var: {
      ...(eventData.var || {}),
      device_id: hashField(deviceId),
      os: osInfo.os,
      os_version: osInfo.os_version,
      os_arch: osInfo.os_arch,
      app_version: getAppVersion(),
      code_version: getCodeVersion(),
    },
  };

  // 保留渲染进程传入的 source
  if (eventData.var && eventData.var.source !== undefined) {
    payload.var.source = eventData.var.source;
  }

  return payload;
}

// ── 发送 ──

/**
 * 将载荷数组发送到埋点 API
 * @param {object[]} payloadArray
 * @returns {Promise<boolean>} 是否成功
 */
async function postToAPI(payloadArray) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomUUID();
  const signature = generateSignature(timestamp, nonce);

  const url = `${TRACKING_API_URL}?project=${TRACKING_PROJECT}&store=${TRACKING_STORE}`;

  // 添加 30s 超时
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-TimeStamp': timestamp,
        'X-Api-Nonce': nonce,
        'X-Api-SignHeaders': 'x-api-nonce,x-api-timestamp',
        'X-Api-ClientID': TRACKING_CLIENT_ID,
        'X-Api-Auth-Version': '2.0',
        'X-Api-Signature': signature,
      },
      body: JSON.stringify(payloadArray),
      signal: controller.signal,
    });

    if (!resp.ok) {
      let body = '';
      try { body = await resp.text(); } catch (_) {}
      console.warn(`[Tracking] postToAPI failed: HTTP ${resp.status}`, body.substring(0, 200));
      return { success: false, error: `HTTP ${resp.status}: ${body}` };
    }

    // 读取响应体
    let respBody = null;
    try { respBody = await resp.json(); } catch (_) {}
    return { success: true, data: respBody };
  } finally {
    clearTimeout(timeout);
  }
}

// ── 本地缓存 ──

const CACHE_PATH = path.join(os.homedir(), '.kcode', 'tracking-cache.jsonl');

/**
 * 将发送失败的载荷追加到本地缓存文件
 * @param {object} payload
 */
function cacheEvent(payload) {
  try {
    const dir = path.dirname(CACHE_PATH);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(CACHE_PATH, JSON.stringify(payload) + '\n', 'utf-8');
  } catch (err) {
    console.error('[Tracking] cacheEvent failed:', err.message);
  }
}

/**
 * 单条事件发送辅助函数
 * @param {object} payload
 * @returns {Promise<boolean>}
 */
async function postSingleEvent(payload) {
  try {
    const result = await postToAPI([payload]);
    return result.success === true;
  } catch (_) {
    return false;
  }
}

/**
 * 延迟 5s 后补传缓存中的失败事件
 * @returns {Promise<void>}
 */
async function flushCachedEvents() {
  await new Promise((resolve) => setTimeout(resolve, 5000));

  let lines;
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf-8');
    lines = raw.split('\n').filter(Boolean);
  } catch (_) {
    return; // 无缓存文件，直接返回
  }

  const events = [];
  for (const line of lines) {
    try { events.push(JSON.parse(line)); } catch (_) { /* 跳过损坏行 */ }
  }
  if (events.length === 0) {
    try { fs.unlinkSync(CACHE_PATH); } catch (_) {}
    return;
  }

  const remaining = [];
  for (const payload of events) {
    const ok = await postSingleEvent(payload);
    if (!ok) remaining.push(payload);
  }

  try {
    if (remaining.length === 0) {
      fs.unlinkSync(CACHE_PATH);
    } else {
      const out = remaining.map((e) => JSON.stringify(e)).join('\n') + '\n';
      fs.writeFileSync(CACHE_PATH, out, 'utf-8');
    }
  } catch (err) {
    console.error('[Tracking] flushCachedEvents write-back failed:', err.message);
  }
}

// ── 主发送入口 ──

/**
 * 发送单条埋点事件，含重试与降级缓存
 * @param {object} eventData
 */
async function sendTrackingEvent(eventData) {
  let payload;
  try {
    payload = buildPayload(eventData);
  } catch (err) {
    console.error('[Tracking] buildPayload failed:', err.message);
    return { success: false, error: `Build failed: ${err.message}` };
  }
  let lastError = '';

  for (let attempt = 0; attempt < TRACKING_MAX_RETRY; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
      }
      const result = await postToAPI([payload]);
      if (result.success) {
        return { success: true, data: result.data };
      }
      lastError = result.error;
    } catch (err) {
      lastError = err.message || String(err);
      console.warn(`[Tracking] attempt ${attempt + 1} failed:`, lastError);
    }
  }

  // 全部重试失败，写入本地缓存
  console.warn('[Tracking] all retries exhausted, caching event');
  cacheEvent(payload);
  return { success: false, error: lastError, cached: true };
}

module.exports = { sendTrackingEvent, flushCachedEvents };
