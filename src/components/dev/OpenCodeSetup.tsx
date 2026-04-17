import { useState, useEffect, useCallback } from 'react'

/* ── Types for Electron IPC ── */

interface InstallProgress {
  stage: 'downloading' | 'extracting' | 'installing' | 'done'
  percent?: number
  downloaded?: number
  totalBytes?: number
}

interface ElectronOpenCodeAPI {
  checkOpencode: () => Promise<{ installed: boolean }>
  getOpencodeVersion: () => Promise<{ version: string | null }>
  installOpencode: () => Promise<{ success: boolean; error?: string }>
  startSidecar: () => Promise<{ success: boolean; url?: string; error?: string }>
  checkUpdate: () => Promise<{ hasUpdate: boolean; currentVersion?: string; latestVersion?: string }>
  updateOpencode: () => Promise<{ success: boolean; error?: string }>
  onInstallProgress: (callback: (progress: InstallProgress) => void) => () => void
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
  | 'not-installed' // 未安装，显示引导
  | 'checking-update' // 检查更新中
  | 'updating'     // 正在下载更新
  | 'downloading'  // 下载中
  | 'extracting'   // 解压中
  | 'installing'   // 安装中
  | 'starting'     // 启动 sidecar 中
  | 'ready'        // 一切就绪
  | 'error'        // 出错

interface SetupState {
  status: SetupStatus
  progress: number
  downloaded: number
  totalBytes: number
  error: string | null
  version: string | null
  latestVersion: string | null
  serverUrl: string | null
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/* ── Hook: useOpenCodeSetup ── */

export interface OpenCodeSetupResult {
  state: SetupState
  install: () => Promise<void>
  retry: () => Promise<void>
}

export function useOpenCodeSetup(): OpenCodeSetupResult {
  const [state, setState] = useState<SetupState>({
    status: 'checking',
    progress: 0,
    downloaded: 0,
    totalBytes: 0,
    error: null,
    version: null,
    latestVersion: null,
    serverUrl: null,
  })

  const check = useCallback(async () => {
    const api = getElectronAPI()
    if (!api) {
      // Not in Electron — dev mode, try reading server info or use fallback
      try {
        const resp = await fetch('http://127.0.0.1:4096/session')
        if (resp.ok) {
          setState(prev => ({ ...prev, status: 'ready', serverUrl: 'http://127.0.0.1:4096' }))
          return
        }
      } catch (_) { /* ignore */ }
      // fallback: assume sidecar runs on 4096 in dev
      setState(prev => ({ ...prev, status: 'ready', serverUrl: 'http://127.0.0.1:4096' }))
      return
    }

    try {
      setState(prev => ({ ...prev, status: 'checking', error: null }))
      // Ensure checking state is visible for at least 800ms
      const [checkResult] = await Promise.all([
        api.checkOpencode(),
        delay(800),
      ])

      if (checkResult.installed) {
        const { version } = await api.getOpencodeVersion()
        // Show "found" state briefly
        setState(prev => ({ ...prev, status: 'found', version }))
        await delay(800)

        // Check for updates
        setState(prev => ({ ...prev, status: 'checking-update' }))
        const updateResult = await api.checkUpdate()
        console.log('[OpenCodeSetup] checkUpdate result:', JSON.stringify(updateResult))

        if (updateResult.hasUpdate && updateResult.latestVersion) {
          console.log('[OpenCodeSetup] Update available:', version, '->', updateResult.latestVersion)
          setState(prev => ({ ...prev, status: 'updating', latestVersion: updateResult.latestVersion || null }))

          // Listen for download progress
          const removeListener = api.onInstallProgress((progress: InstallProgress) => {
            if (progress.stage === 'downloading') {
              setState(prev => ({
                ...prev,
                status: 'updating',
                progress: progress.percent || 0,
                downloaded: progress.downloaded || 0,
                totalBytes: progress.totalBytes || 0,
              }))
            } else if (progress.stage === 'extracting') {
              setState(prev => ({ ...prev, status: 'extracting', progress: progress.percent || 0 }))
            } else if (progress.stage === 'installing') {
              setState(prev => ({ ...prev, status: 'installing', progress: progress.percent || 0 }))
            } else if (progress.stage === 'done') {
              setState(prev => ({ ...prev, status: 'installing', progress: 100 }))
            }
          })

          try {
            const updateRes = await api.updateOpencode()
            removeListener()
            if (!updateRes.success) {
              console.warn('[OpenCodeSetup] Update failed:', updateRes.error)
              // Update failed, but old version still works, continue to start
            } else {
              // Refresh version after update
              const { version: newVer } = await api.getOpencodeVersion()
              setState(prev => ({ ...prev, version: newVer }))
            }
          } catch (err) {
            removeListener()
            console.warn('[OpenCodeSetup] Update error:', err)
            // Non-fatal: continue with existing version
          }
        }

        // Auto-start sidecar
        setState(prev => ({ ...prev, status: 'starting' }))
        const result = await api.startSidecar()
        console.log('[OpenCodeSetup] startSidecar result:', JSON.stringify(result))
        if (result.success) {
          const url = result.url || null
          if (!url) {
            console.warn('[OpenCodeSetup] startSidecar succeeded but no url returned, trying getServerInfo')
          }
          setState(prev => ({ ...prev, status: 'ready', serverUrl: url }))
        } else {
          setState(prev => ({ ...prev, status: 'error', error: result.error || '启动 Kingdee Code 服务失败' }))
        }
      } else {
        setState(prev => ({ ...prev, status: 'not-installed' }))
      }
    } catch (err) {
      console.error('[OpenCodeSetup] Check failed:', err)
      setState(prev => ({ ...prev, status: 'error', error: String(err) }))
    }
  }, [])

  const install = useCallback(async () => {
    const api = getElectronAPI()
    if (!api) return

    setState(prev => ({ ...prev, status: 'downloading', progress: 0, error: null }))

    // Listen for progress
    const removeListener = api.onInstallProgress((progress: InstallProgress) => {
      if (progress.stage === 'downloading') {
        setState(prev => ({
          ...prev,
          status: 'downloading',
          progress: progress.percent || 0,
          downloaded: progress.downloaded || 0,
          totalBytes: progress.totalBytes || 0,
        }))
      } else if (progress.stage === 'extracting') {
        setState(prev => ({ ...prev, status: 'extracting', progress: progress.percent || 0 }))
      } else if (progress.stage === 'installing') {
        setState(prev => ({ ...prev, status: 'installing', progress: progress.percent || 0 }))
      } else if (progress.stage === 'done') {
        setState(prev => ({ ...prev, status: 'installing', progress: 100 }))
      }
    })

    try {
      const result = await api.installOpencode()
      removeListener()

      if (result.success) {
        // Start sidecar after install
        setState(prev => ({ ...prev, status: 'starting' }))
        const startResult = await api.startSidecar()
        if (startResult.success) {
          setState(prev => ({ ...prev, status: 'ready', serverUrl: startResult.url || null }))
        } else {
          setState(prev => ({ ...prev, status: 'error', error: startResult.error || '启动 Kingdee Code 服务失败' }))
        }
      } else {
        setState(prev => ({ ...prev, status: 'error', error: result.error || '安装失败' }))
      }
    } catch (err) {
      removeListener()
      setState(prev => ({ ...prev, status: 'error', error: String(err) }))
    }
  }, [])

  useEffect(() => {
    check()
  }, [check])

  return { state, install, retry: check }
}

/* ── Component: OpenCodeSetup ── */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

interface OpenCodeSetupProps {
  state: SetupState
  onInstall: () => void
  onRetry: () => void
}

export default function OpenCodeSetup({ state, onInstall, onRetry }: OpenCodeSetupProps) {
  const { status, progress, downloaded, totalBytes, error } = state

  if (status === 'checking') {
    return (
      <div className="dt-setup">
        <div className="dt-setup-card">
          <div className="dt-setup-spinner" />
          <h3>检测 Kingdee Code 环境...</h3>
          <p className="dt-setup-desc">正在检查 Kingdee Code 是否已安装</p>
        </div>
      </div>
    )
  }

  if (status === 'found' || status === 'checking-update') {
    return (
      <div className="dt-setup">
        <div className="dt-setup-card">
          <div className="dt-setup-icon dt-setup-icon-ok">✅</div>
          <h3>已检测到 Kingdee Code</h3>
          <p className="dt-setup-desc">
            {state.version ? `版本: ${state.version}` : '准备启动服务...'}
            {status === 'checking-update' && <><br />正在检查更新...</>}
          </p>
          {status === 'checking-update' && <div className="dt-setup-spinner" style={{ width: 24, height: 24, marginTop: 8 }} />}
        </div>
      </div>
    )
  }

  if (status === 'updating') {
    return (
      <div className="dt-setup">
        <div className="dt-setup-card">
          <div className="dt-setup-icon">⬆️</div>
          <h3>正在下载更新...</h3>
          <p className="dt-setup-desc">
            {state.latestVersion ? `新版本: ${state.latestVersion}` : '发现新版本'}
          </p>
          <div className="dt-progress-bar">
            <div className="dt-progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <p className="dt-setup-desc">
            {progress}%
            {totalBytes > 0 && ` — ${formatBytes(downloaded)} / ${formatBytes(totalBytes)}`}
          </p>
        </div>
      </div>
    )
  }

  if (status === 'not-installed') {
    return (
      <div className="dt-setup">
        <div className="dt-setup-card">
          <div className="dt-setup-icon">📦</div>
          <h3>需要安装 Kingdee Code</h3>
          <p className="dt-setup-desc">
            开发页签需要 Kingdee Code 引擎支持。<br />
            点击下方按钮自动下载并安装。
          </p>
          <button className="dt-setup-btn primary" onClick={onInstall}>
            ⬇️ 下载并安装 Kingdee Code
          </button>
          <p className="dt-setup-hint">
            约 35 MB，来自 Kingdee 服务器
          </p>
        </div>
      </div>
    )
  }

  if (status === 'downloading') {
    return (
      <div className="dt-setup">
        <div className="dt-setup-card">
          <div className="dt-setup-icon">⬇️</div>
          <h3>正在下载 Kingdee Code...</h3>
          <div className="dt-progress-bar">
            <div className="dt-progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <p className="dt-setup-desc">
            {progress}%
            {totalBytes > 0 && ` — ${formatBytes(downloaded)} / ${formatBytes(totalBytes)}`}
          </p>
        </div>
      </div>
    )
  }

  if (status === 'extracting' || status === 'installing') {
    return (
      <div className="dt-setup">
        <div className="dt-setup-card">
          <div className="dt-setup-spinner" />
          <h3>{status === 'extracting' ? '正在解压...' : '正在安装...'}</h3>
          <p className="dt-setup-desc">请稍候，即将完成</p>
        </div>
      </div>
    )
  }

  if (status === 'starting') {
    return (
      <div className="dt-setup">
        <div className="dt-setup-card">
          <div className="dt-setup-spinner" />
          <h3>正在启动 Kingdee Code 服务...</h3>
          <p className="dt-setup-desc">连接到本地引擎</p>
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
