import { useState, useEffect, useCallback, useRef } from 'react'
import { t, type Lang, type MessageKey } from '../../i18n'

/* ── Types for LingeeBridge IPC ── */

interface LingeeBridgeOpenCodeAPI {
  checkOpencode: () => Promise<{ installed: boolean }>
  getOpencodeVersion: () => Promise<{ version: string | null }>
  startSidecar: () => Promise<{ success: boolean; url?: string; error?: string }>
  installOpencode: () => Promise<{ success: boolean; error?: string }>
  getInstallState: () => Promise<{ status: string; progress: number; error: string | null }>
  onInstallProgress: (callback: (data: InstallProgress) => void) => () => void
}

interface InstallProgress {
  status: 'downloading' | 'installing' | 'done' | 'error'
  progress?: number
  error?: string
}

function getLingeeBridgeAPI(): LingeeBridgeOpenCodeAPI | null {
  const api = (window as unknown as Record<string, unknown>).lingeeBridge as
    | LingeeBridgeOpenCodeAPI
    | undefined
  return api?.checkOpencode ? api : null
}

/* ── Setup States ── */

export type SetupStatus =
  | 'checking'      // 检测中
  | 'found'         // 已检测到，短暂显示
  | 'not-installed'  // 未安装
  | 'downloading'    // 正在从 CDN 下载
  | 'installing'     // 正在安装（解压）
  | 'starting'       // 启动 sidecar 中
  | 'ready'          // 一切就绪
  | 'error'          // 出错

interface SetupState {
  status: SetupStatus
  error: string | null
  version: string | null
  serverUrl: string | null
  downloadProgress: number  // 0-100
}

/* ── Hook: useOpenCodeSetup ── */

export interface OpenCodeSetupResult {
  state: SetupState
  retry: () => Promise<void>
}

export function useOpenCodeSetup(): OpenCodeSetupResult {
  const [state, setState] = useState<SetupState>({
    status: 'checking',
    error: null,
    version: null,
    serverUrl: null,
    downloadProgress: 0,
  })

  const runningRef = useRef(false)

  const check = useCallback(async () => {
    // Prevent concurrent runs (StrictMode double-mount / HMR)
    if (runningRef.current) {
      console.log('[OpenCodeSetup] check() skipped — already running')
      return
    }
    runningRef.current = true
    console.log('[OpenCodeSetup] check() START', new Date().toISOString())

    const api = getLingeeBridgeAPI()
    if (!api) {
      console.log('[OpenCodeSetup] No lingeeBridge, using browser fallback')
      try {
        const resp = await fetch('http://127.0.0.1:4096/session')
        if (resp.ok) {
          console.log('[OpenCodeSetup] Browser fallback: sidecar reachable')
          setState(prev => ({ ...prev, status: 'ready', serverUrl: 'http://127.0.0.1:4096' }))
          return
        }
      } catch (_) { /* ignore */ }
      console.log('[OpenCodeSetup] Browser fallback: assume sidecar on 4096')
      setState(prev => ({ ...prev, status: 'ready', serverUrl: 'http://127.0.0.1:4096' }))
      return
    }

    try {
      console.log('[OpenCodeSetup] → status: checking')
      setState(prev => ({ ...prev, status: 'checking', error: null }))
      const checkResult = await api.checkOpencode()
      console.log('[OpenCodeSetup] checkOpencode result:', JSON.stringify(checkResult))

      if (!checkResult.installed) {
        // Check if already downloading in background
        const installState = await api.getInstallState()
        if (installState.status === 'downloading') {
          console.log('[OpenCodeSetup] Already downloading, progress:', installState.progress)
          setState(prev => ({ ...prev, status: 'downloading', downloadProgress: installState.progress }))
          // Don't trigger another install, just wait for events
          return
        } else if (installState.status === 'installing') {
          setState(prev => ({ ...prev, status: 'installing' }))
          return
        }

        // Not installed, start download
        console.log('[OpenCodeSetup] Not installed, starting CDN download...')
        setState(prev => ({ ...prev, status: 'downloading', downloadProgress: 0 }))
        const installResult = await api.installOpencode()

        if (!installResult.success) {
          console.log('[OpenCodeSetup] Install failed:', installResult.error)
          setState(prev => ({ ...prev, status: 'error', error: installResult.error || 'setupInstallFailed' }))
          return
        }
        // Install succeeded, now start sidecar
      }

      // opencode exists (or just installed), start sidecar
      const { version } = await api.getOpencodeVersion()
      console.log('[OpenCodeSetup] found opencode v' + version + ', starting sidecar...')
      setState(prev => ({ ...prev, status: 'starting', version }))
      const result = await api.startSidecar()
      console.log('[OpenCodeSetup] startSidecar result:', JSON.stringify(result))
      if (result.success) {
        const url = result.url || null
        console.log('[OpenCodeSetup] → status: ready, serverUrl:', url)
        setState(prev => ({ ...prev, status: 'ready', serverUrl: url }))
      } else {
        console.log('[OpenCodeSetup] → status: error', result.error)
        setState(prev => ({ ...prev, status: 'error', error: result.error || 'setupStartFailed' }))
      }
    } catch (err) {
      console.error('[OpenCodeSetup] Check failed:', err)
      setState(prev => ({ ...prev, status: 'error', error: String(err) }))
    } finally {
      console.log('[OpenCodeSetup] check() END', new Date().toISOString())
      runningRef.current = false
    }
  }, [])

  // Listen for install progress events from main process
  useEffect(() => {
    const api = getLingeeBridgeAPI()
    if (!api?.onInstallProgress) return

    const unsub = api.onInstallProgress((data: InstallProgress) => {
      console.log('[OpenCodeSetup] install progress:', JSON.stringify(data))
      if (data.status === 'downloading') {
        setState(prev => ({ ...prev, status: 'downloading', downloadProgress: data.progress || 0 }))
      } else if (data.status === 'installing') {
        setState(prev => ({ ...prev, status: 'installing' }))
      } else if (data.status === 'error') {
        setState(prev => ({ ...prev, status: 'error', error: data.error || 'setupInstallFailed' }))
        runningRef.current = false
      }
      // 'done' is handled by the check() flow continuing after installOpencode resolves
    })

    return unsub
  }, [])

  useEffect(() => {
    check()
  }, [check])

  return { state, retry: check }
}

/* ── Component: OpenCodeSetup ── */

interface OpenCodeSetupProps {
  state: SetupState
  onRetry: () => void
  lang: Lang
}

// hook 存储的 error 可能是 i18n key（回退值）或 API 返回的原始错误字符串
const I18N_ERROR_KEYS = new Set<string>(['setupInstallFailed', 'setupStartFailed'])

export default function OpenCodeSetup({ state, onRetry, lang }: OpenCodeSetupProps) {
  const { status, error, downloadProgress } = state
  // 如果 error 是已知的 i18n key，则翻译显示；否则直接展示 API 错误信息
  const displayError = error && I18N_ERROR_KEYS.has(error) ? t(lang, error as MessageKey) : error

  // checking / found → 静默等待，不显示 UI
  if (status === 'checking' || status === 'found') {
    return null
  }

  if (status === 'downloading') {
    return (
      <div className="dt-setup">
        <div className="dt-setup-card">
          <div className="dt-setup-icon">⬇️</div>
          <h3>{t(lang, 'setupNewVersion')}</h3>
          <p className="dt-setup-desc">{t(lang, 'setupDownloading')}</p>
          <div className="dt-progress-bar">
            <div className="dt-progress-fill" style={{ width: `${downloadProgress}%` }} />
          </div>
          <p className="dt-setup-hint">{downloadProgress}%</p>
        </div>
      </div>
    )
  }

  if (status === 'installing') {
    return (
      <div className="dt-setup">
        <div className="dt-setup-card">
          <div className="dt-setup-icon">📦</div>
          <h3>{t(lang, 'setupInstalling')}</h3>
          <p className="dt-setup-desc">{t(lang, 'setupInstallingDesc')}</p>
          <div className="dt-setup-spinner" />
        </div>
      </div>
    )
  }

  if (status === 'starting') {
    return (
      <div className="dt-setup">
        <div className="dt-setup-card">
          <div className="dt-setup-icon">🚀</div>
          <h3>{t(lang, 'setupStarting')}</h3>
          <p className="dt-setup-desc">{t(lang, 'setupStartingDesc')}</p>
          <div className="dt-setup-spinner" />
        </div>
      </div>
    )
  }

  if (status === 'not-installed') {
    return (
      <div className="dt-setup">
        <div className="dt-setup-card">
          <div className="dt-setup-icon">📦</div>
          <h3>{t(lang, 'setupNotInstalled')}</h3>
          <p className="dt-setup-desc">
            {t(lang, 'setupNotInstalledDesc')}<br />
            {t(lang, 'setupNotInstalledHint')}
          </p>
          <button className="dt-setup-btn primary" onClick={onRetry}>
            🔄 {t(lang, 'setupRetryDownload')}
          </button>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="dt-setup">
        <div className="dt-setup-card">
          <div className="dt-setup-icon">❌</div>
          <h3>{t(lang, 'setupError')}</h3>
          <p className="dt-setup-desc dt-setup-error">{displayError}</p>
          <button className="dt-setup-btn primary" onClick={onRetry}>
            🔄 {t(lang, 'setupRetry')}
          </button>
        </div>
      </div>
    )
  }

  // status === 'ready' → should not render this component
  return null
}
