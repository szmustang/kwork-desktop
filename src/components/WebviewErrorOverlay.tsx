import type { Lang } from '../i18n'
import { t } from '../i18n'
import '../styles/webview-error.css'

interface WebviewErrorOverlayProps {
  errorDescription: string
  onRetry: () => void
  lang: Lang
}

/**
 * WebView 加载失败时的错误覆盖层。
 * 替代 Chromium 默认错误页面，提供友好提示 + 重试按钮。
 */
export default function WebviewErrorOverlay({ errorDescription, onRetry, lang }: WebviewErrorOverlayProps) {
  // 根据错误描述判断是否为网络类错误（含导航失败和 JS 资源加载失败）
  const isNetworkError = /net::|ERR_CONNECTION|ERR_NAME|ERR_INTERNET|ERR_NETWORK|ERR_TIMED_OUT|ERR_DNS|Failed to fetch dynamically imported module|ChunkLoadError|Loading chunk .+ failed/i.test(errorDescription)

  return (
    <div className="wv-error-overlay">
      <div className="wv-error-card">
        <div className="wv-error-icon">
          {isNetworkError ? (
            /* 断网图标 */
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
              <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
              <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
              <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
              <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
              <line x1="12" y1="20" x2="12.01" y2="20" />
            </svg>
          ) : (
            /* 通用错误图标 */
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          )}
        </div>
        <h3 className="wv-error-title">
          {isNetworkError ? t(lang, 'webviewNetworkError') : t(lang, 'webviewLoadError')}
        </h3>
        <p className="wv-error-desc">
          {isNetworkError ? t(lang, 'webviewNetworkErrorDesc') : t(lang, 'webviewLoadErrorDesc')}
        </p>
        <p className="wv-error-detail">{errorDescription}</p>
        <button className="wv-error-retry-btn" onClick={onRetry}>
          {t(lang, 'webviewRetry')}
        </button>
      </div>
    </div>
  )
}
