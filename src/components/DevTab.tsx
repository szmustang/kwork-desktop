import { useCallback } from 'react'
import OpenCodeSetup, { type OpenCodeSetupResult } from './dev/OpenCodeSetup'
import { useWebviewErrorHandler } from '../hooks/useWebviewErrorHandler'
import WebviewErrorOverlay from './WebviewErrorOverlay'
import type { Lang } from '../i18n'
import '../styles/dev-tab.css'

/* ====== OpenCode Webview ====== */

function OpenCodeWebview({ serverUrl, lang }: { serverUrl: string; lang: Lang }) {
  // DevTab 专用：dom-ready 后注入浅色主题覆盖脚本
  const handleDomReady = useCallback((webview: HTMLWebViewElement) => {
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
  }, [])

  const { webviewRef, ready, error, handleRetry } = useWebviewErrorHandler({
    tag: 'DevTab',
    onDomReady: handleDomReady,
  })

  return (
    <>
      {error ? (
        <WebviewErrorOverlay errorDescription={error} onRetry={handleRetry} lang={lang} />
      ) : !ready ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="dt-setup-spinner" />
        </div>
      ) : null}
      <webview
        ref={webviewRef as any}
        src={`${serverUrl}/`}
        style={{
          flex: 1, width: '100%', height: '100%', border: 'none', minHeight: 0,
          visibility: ready && !error ? 'visible' : 'hidden',
          position: ready && !error ? 'static' : 'absolute',
        }}
        allowpopups={'true' as any}
      />
    </>
  )
}

export default function DevTab({ setup, lang }: { setup: OpenCodeSetupResult; lang: Lang }) {
  const { status, serverUrl } = setup.state

  // 未安装 / 出错 / 下载中 / 安装中 / 启动中 → 显示提示
  if (status === 'not-installed' || status === 'error' || status === 'downloading' || status === 'installing' || status === 'starting') {
    return (
      <div className="dt-container">
        <OpenCodeSetup
          state={setup.state}
          onRetry={setup.retry}
          lang={lang}
        />
      </div>
    )
  }

  // 就绪且有 serverUrl → 加载 webview
  if (status === 'ready' && serverUrl) {
    return (
      <div className="dt-container" style={{ display: 'flex', flexDirection: 'column' }}>
        <OpenCodeWebview serverUrl={serverUrl} lang={lang} />
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
