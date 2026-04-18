import { useRef, useEffect, useState } from 'react'
import OpenCodeSetup, { type OpenCodeSetupResult } from './dev/OpenCodeSetup'
import '../styles/dev-tab.css'

/* ====== OpenCode Webview ====== */

function OpenCodeWebview({ serverUrl }: { serverUrl: string }) {
  const webviewRef = useRef<HTMLWebViewElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return

    const onReady = () => {
      console.log('[DevTab] webview dom-ready')
      const wv = webview as any
      if (wv.executeJavaScript) {
        wv.executeJavaScript(`
          (function() {
            const origMatchMedia = window.matchMedia.bind(window);
            window.matchMedia = function(query) {
              if (query === '(prefers-color-scheme: dark)') {
                return { matches: false, media: query, onchange: null,
                  addListener: function(){}, removeListener: function(){},
                  addEventListener: function(){}, removeEventListener: function(){},
                  dispatchEvent: function(){ return true; } };
              }
              if (query === '(prefers-color-scheme: light)') {
                return { matches: true, media: query, onchange: null,
                  addListener: function(){}, removeListener: function(){},
                  addEventListener: function(){}, removeEventListener: function(){},
                  dispatchEvent: function(){ return true; } };
              }
              return origMatchMedia(query);
            };
            document.documentElement.style.colorScheme = 'light';
            document.documentElement.classList.remove('dark');
            document.documentElement.classList.add('light');
            document.documentElement.setAttribute('data-theme', 'light');
          })();
        `).catch(() => {})
      }
    }
    // 等客户端路由跳转完成后再显示 webview
    const onNavigated = () => {
      console.log('[DevTab] webview did-stop-loading')
      if (!ready) setReady(true)
    }
    const onFail = (e: Event) => {
      console.error('[DevTab] webview load failed:', (e as any).errorDescription)
    }

    webview.addEventListener('dom-ready', onReady)
    webview.addEventListener('did-stop-loading', onNavigated)
    webview.addEventListener('did-fail-load', onFail)
    return () => {
      webview.removeEventListener('dom-ready', onReady)
      webview.removeEventListener('did-stop-loading', onNavigated)
      webview.removeEventListener('did-fail-load', onFail)
    }
  }, [ready])

  return (
    <>
      {!ready && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="dt-setup-spinner" />
        </div>
      )}
      <webview
        ref={webviewRef as any}
        src={`${serverUrl}/`}
        style={{
          flex: 1, width: '100%', height: '100%', border: 'none', minHeight: 0,
          visibility: ready ? 'visible' : 'hidden',
          position: ready ? 'static' : 'absolute',
        }}
        allowpopups={'true' as any}
      />
    </>
  )
}

export default function DevTab({ setup }: { setup: OpenCodeSetupResult }) {
  const { status, serverUrl } = setup.state

  // 未安装 / 出错 / 下载中 / 安装中 / 启动中 → 显示提示
  if (status === 'not-installed' || status === 'error' || status === 'downloading' || status === 'installing' || status === 'starting') {
    return (
      <div className="dt-container">
        <OpenCodeSetup
          state={setup.state}
          onRetry={setup.retry}
        />
      </div>
    )
  }

  // 就绪且有 serverUrl → 加载 webview
  if (status === 'ready' && serverUrl) {
    return (
      <div className="dt-container" style={{ display: 'flex', flexDirection: 'column' }}>
        <OpenCodeWebview serverUrl={serverUrl} />
      </div>
    )
  }

  // 其他情况（checking / ready但无url）→ spinner
  return (
    <div className="dt-container">
      <div className="dt-setup">
        <div className="dt-setup-spinner" />
      </div>
    </div>
  )
}
