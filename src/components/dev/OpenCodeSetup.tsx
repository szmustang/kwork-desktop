import { useState, useEffect, useCallback, useRef } from 'react'

/* ── Types for Electron IPC ── */

interface ElectronOpenCodeAPI {
  checkOpencode: () => Promise<{ installed: boolean }>
  getOpencodeVersion: () => Promise<{ version: string | null }>
  startSidecar: () => Promise<{ success: boolean; url?: string; error?: string }>
}

function getElectronAPI(): ElectronOpenCodeAPI | null {
  const api = (window as unknown as Record<string, unknown>).electronAPI as
    | ElectronOpenCodeAPI
    | undefined
  return api?.checkOpencode ? api : null
}

/* ── Setup States ── */

export type SetupStatus =
  | 'checking'     // 检测中
  | 'found'        // 已检测到，短暂显示
  | 'not-installed' // 未安装（壳内未打包 opencode）
  | 'starting'     // 启动 sidecar 中
  | 'ready'        // 一切就绪
  | 'error'        // 出错

interface SetupState {
  status: SetupStatus
  error: string | null
  version: string | null
  serverUrl: string | null
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

    const api = getElectronAPI()
    if (!api) {
      console.log('[OpenCodeSetup] No electronAPI, using browser fallback')
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

      if (checkResult.installed) {
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
          setState(prev => ({ ...prev, status: 'error', error: result.error || '启动 Kingdee Code 服务失败' }))
        }
      } else {
        console.log('[OpenCodeSetup] → status: not-installed')
        setState(prev => ({ ...prev, status: 'not-installed' }))
      }
    } catch (err) {
      console.error('[OpenCodeSetup] Check failed:', err)
      setState(prev => ({ ...prev, status: 'error', error: String(err) }))
    } finally {
      console.log('[OpenCodeSetup] check() END', new Date().toISOString())
      runningRef.current = false
    }
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
}

export default function OpenCodeSetup({ state, onRetry }: OpenCodeSetupProps) {
  const { status, error } = state

  // checking / found / starting → 静默等待，不显示 UI
  if (status === 'checking' || status === 'found' || status === 'starting') {
    return null
  }

  if (status === 'not-installed') {
    return (
      <div className="dt-setup">
        <div className="dt-setup-card">
          <div className="dt-setup-icon">📦</div>
          <h3>Kingdee Code 未安装</h3>
          <p className="dt-setup-desc">
            开发页签需要 Kingdee Code 引擎支持。<br />
            请重新安装应用或联系管理员。
          </p>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="dt-setup">
        <div className="dt-setup-card">
          <div className="dt-setup-icon">❌</div>
          <h3>出错了</h3>
          <p className="dt-setup-desc dt-setup-error">{error}</p>
          <button className="dt-setup-btn primary" onClick={onRetry}>
            🔄 重试
          </button>
        </div>
      </div>
    )
  }

  // status === 'ready' → should not render this component
  return null
}
