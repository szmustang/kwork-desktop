import { LINGEE_BASE_URL } from '../constants'
import { useWebviewErrorHandler } from '../hooks/useWebviewErrorHandler'
import WebviewErrorOverlay from './WebviewErrorOverlay'
import type { Lang } from '../i18n'

const WORK_URL = `${LINGEE_BASE_URL}/session/new`

export default function WorkTab({ lang }: { lang: Lang }) {
  const { webviewRef, ready, error, handleRetry } = useWebviewErrorHandler({ tag: 'WorkTab' })

  return (
    <div className="tab-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {error ? (
        <WebviewErrorOverlay errorDescription={error} onRetry={handleRetry} lang={lang} />
      ) : !ready ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="dt-setup-spinner" />
        </div>
      ) : null}
      <webview
        ref={webviewRef as any}
        src={WORK_URL}
        style={{
          flex: 1, width: '100%', height: '100%', border: 'none', minHeight: 0,
          visibility: ready && !error ? 'visible' : 'hidden',
          position: ready && !error ? 'static' : 'absolute',
        }}
        allowpopups={'true' as any}
      />
    </div>
  )
}
