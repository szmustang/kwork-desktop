import { useRef, useEffect, useState } from 'react'

const CHAT_URL = 'https://devtest.kingdee.com/chatbot/new'

export default function ChatTab() {
  const webviewRef = useRef<HTMLWebViewElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return

    const onReady = () => {
      console.log('[ChatTab] webview dom-ready')
    }
    // 转发 webview 内页面的 console 日志到主窗口 DevTools
    const onConsole = (e: any) => {
      const methods = ['log', 'warn', 'error', 'info', 'debug'] as const
      const fn = methods[e.level] || 'log'
      console[fn](`[ChatTab:webview]`, e.message)
    }
    const onNavigated = () => {
      console.log('[ChatTab] webview did-stop-loading')
      if (!ready) setReady(true)
    }
    const onFail = (e: Event) => {
      console.error('[ChatTab] webview load failed:', (e as any).errorDescription)
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
  }, [ready])

  return (
    <div className="tab-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {!ready && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="dt-setup-spinner" />
        </div>
      )}
      <webview
        ref={webviewRef as any}
        src={CHAT_URL}
        style={{
          flex: 1, width: '100%', height: '100%', border: 'none', minHeight: 0,
          visibility: ready ? 'visible' : 'hidden',
          position: ready ? 'static' : 'absolute',
        }}
        allowpopups={'true' as any}
      />
    </div>
  )
}
