import { useRef, useEffect, useState, useCallback, type RefObject } from 'react'

/**
 * WebView 错误处理 + 自动重试 Hook
 *
 * 双层错误检测：
 * 1. did-fail-load — 导航级失败（DNS/连接拒绝/超时等）
 * 2. console-message — SPA 运行时致命错误（JS chunk 动态加载失败导致白屏）
 *
 * 自动重试策略：
 * 首次检测到 JS chunk 失败时，自动 reloadIgnoringCache() 绕过缓存，
 * 让 did-fail-load 暴露真实网络错误。仅重试一次，避免无限循环。
 */

/** JS chunk 加载失败的错误模式 */
const CHUNK_FAIL_RE = /Failed to fetch dynamically imported module|ChunkLoadError|Loading chunk .+ failed/i

interface UseWebviewErrorHandlerOptions {
  /** 日志前缀标签，如 'ChatTab' / 'WorkTab' / 'DevTab' */
  tag: string
  /** dom-ready 后的额外回调（如 DevTab 注入浅色主题脚本） */
  onDomReady?: (webview: HTMLWebViewElement) => void
}

interface UseWebviewErrorHandlerReturn {
  webviewRef: RefObject<HTMLWebViewElement | null>
  ready: boolean
  error: string | null
  handleRetry: () => void
}

export function useWebviewErrorHandler(
  options: UseWebviewErrorHandlerOptions,
): UseWebviewErrorHandlerReturn {
  const { tag, onDomReady } = options
  const webviewRef = useRef<HTMLWebViewElement>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 防止多条 console error 重复触发
  const errorSetRef = useRef(false)
  // JS chunk 加载失败时自动绕过缓存重载一次，让 did-fail-load 暴露真实网络错误
  const autoRetryRef = useRef(false)

  const handleRetry = useCallback(() => {
    const webview = webviewRef.current as any
    if (!webview) return
    setError(null)
    setReady(false)
    errorSetRef.current = false
    autoRetryRef.current = false
    webview.reloadIgnoringCache()
  }, [])

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return

    const onReady = () => {
      console.log(`[${tag}] webview dom-ready`)
      onDomReady?.(webview)
    }

    // 转发 webview 内页面的 console 日志到主窗口 DevTools
    const onConsole = (e: any) => {
      const methods = ['log', 'warn', 'error', 'info', 'debug'] as const
      const fn = methods[e.level] || 'log'
      console[fn](`[${tag}:webview]`, e.message)
      // 检测 SPA 致命错误：JS chunk 加载失败会导致白屏
      if (e.level >= 2 && !errorSetRef.current) {
        const msg = e.message || ''
        if (CHUNK_FAIL_RE.test(msg)) {
          errorSetRef.current = true
          // 首次检测到：HTML 可能来自缓存，自动绕过缓存重载以暴露真实网络错误
          if (!autoRetryRef.current) {
            autoRetryRef.current = true
            console.warn(`[${tag}] JS chunk load failed, auto-retrying without cache...`)
            setReady(false)
            const wv = webview as any
            wv.reloadIgnoringCache?.()
            // 注意：此处不重置 errorSetRef，保持 true 以阻挡同一批次的后续 console error
            // errorSetRef 会在 did-stop-loading（页面加载完成）时重置
          } else {
            // 已经自动重试过仍然失败，展示错误覆盖层
            console.error(`[${tag}] Fatal JS error after auto-retry, showing error overlay`)
            setError(msg)
          }
        }
      }
    }

    const onNavigated = () => {
      console.log(`[${tag}] webview did-stop-loading`)
      // 页面加载完成（无论成功或失败后停止），重置错误检测标志，允许后续检测
      errorSetRef.current = false
      if (!ready) setReady(true)
    }

    const onFail = (e: any) => {
      // 只处理主框架失败，忽略 iframe 等子框架
      if (!e.isMainFrame) return
      // errorCode === -3 是 ERR_ABORTED，通常由页面内部导航取消触发，非真正错误
      if (e.errorCode === -3) return
      console.error(`[${tag}] webview load failed:`, e.errorDescription)
      setError(e.errorDescription || 'Unknown error')
    }

    webview.addEventListener('dom-ready', onReady)
    webview.addEventListener('did-stop-loading', onNavigated)
    webview.addEventListener('did-fail-load', onFail)
    webview.addEventListener('console-message', onConsole)
    return () => {
      webview.removeEventListener('dom-ready', onReady)
      webview.removeEventListener('did-stop-loading', onNavigated)
      webview.removeEventListener('did-fail-load', onFail)
      webview.removeEventListener('console-message', onConsole)
    }
  }, [ready, tag, onDomReady])

  return { webviewRef, ready, error, handleRetry }
}
