/**
 * 环境基础 URL
 *
 * Electron 主进程侧常量，与 src/constants.ts 保持一致。
 * 切换环境时两处需同时修改。
 */
const LINGEE_BASE_URL = 'https://itkworkuat.kingdee.com';

// ---- 埋点配置 ----
const TRACKING_API_URL = 'https://bj2-api.kingdee.com/laddercs/ladderlog'
const TRACKING_SECRET_KEY = '7d80644e27da0ac29d855cc9145e1195'
const TRACKING_CLIENT_ID = '204830'
const TRACKING_PROJECT = 'lingee'
const TRACKING_STORE = 'app_beacon'
const TRACKING_MAX_RETRY = 3

module.exports = {
  LINGEE_BASE_URL,
  TRACKING_API_URL,
  TRACKING_SECRET_KEY,
  TRACKING_CLIENT_ID,
  TRACKING_PROJECT,
  TRACKING_STORE,
  TRACKING_MAX_RETRY,
};
