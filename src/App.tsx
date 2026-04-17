import { useState, useEffect, useCallback, useRef, Component, type ReactNode, type ErrorInfo } from 'react'
import ChatTab from './components/ChatTab'
import WorkTab from './components/WorkTab'
import DevTab from './components/DevTab'
import { useOpenCodeSetup } from './components/dev/OpenCodeSetup'
import './App.css'

// 错误边界：防止子组件崩溃导致整个页面白屏
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('[ErrorBoundary]', error, info) }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, color: '#e5534b', textAlign: 'center' }}>
          <h3>页面出错了</h3>
          <p style={{ color: '#8b949e', margin: '8px 0 16px' }}>{this.state.error.message}</p>
          <button onClick={() => this.setState({ error: null })} style={{ padding: '8px 16px', cursor: 'pointer' }}>重试</button>
        </div>
      )
    }
    return this.props.children
  }
}

type TabKey = 'chat' | 'work' | 'dev'

const tabs: { key: TabKey; label: string }[] = [
  { key: 'chat', label: '对话' },
  { key: 'work', label: '工作' },
  { key: 'dev', label: '开发' },
]

/* ── 右下角更新提示弹窗 ── */

const UPDATE_CHECK_INTERVAL = 15 * 60 * 1000 // 15 分钟

function UpdateToast() {
  const [updateInfo, setUpdateInfo] = useState<{ latestVersion: string } | null>(null)
  const [updating, setUpdating] = useState(false)
  const [progress, setProgress] = useState(0)
  const dismissed = useRef(false)

  const checkUpdate = useCallback(async () => {
    if (dismissed.current || updating) return
    const api = (window as any).electronAPI
    if (!api?.checkUpdate) return

    try {
      const result = await api.checkUpdate()
      console.log('[UpdateToast] check result:', JSON.stringify(result))
      if (result.hasUpdate && result.latestVersion) {
        setUpdateInfo({ latestVersion: result.latestVersion })
      }
    } catch (err) {
      console.warn('[UpdateToast] check failed:', err)
    }
  }, [updating])

  useEffect(() => {
    // 首次延迟 2 分钟后检查（避免与启动时检查冲突）
    const initialTimer = setTimeout(checkUpdate, 2 * 60 * 1000)
    // 之后每 15 分钟检查一次
    const interval = setInterval(checkUpdate, UPDATE_CHECK_INTERVAL)
    return () => {
      clearTimeout(initialTimer)
      clearInterval(interval)
    }
  }, [checkUpdate])

  const handleUpdate = async () => {
    const api = (window as any).electronAPI
    if (!api) return

    setUpdating(true)
    setProgress(0)

    // 监听下载进度
    const removeListener = api.onInstallProgress?.((p: any) => {
      if (p.stage === 'downloading' && p.percent) {
        setProgress(p.percent)
      }
    })

    try {
      const result = await api.updateOpencode()
      if (removeListener) removeListener()

      if (result.success) {
        // 更新成功，重启应用
        api.relaunchApp()
      } else {
        console.error('[UpdateToast] update failed:', result.error)
        setUpdating(false)
        setUpdateInfo(null)
      }
    } catch (err) {
      if (removeListener) removeListener()
      console.error('[UpdateToast] update error:', err)
      setUpdating(false)
      setUpdateInfo(null)
    }
  }

  const handleDismiss = () => {
    dismissed.current = true
    setUpdateInfo(null)
  }

  if (!updateInfo) return null

  return (
    <div className="update-toast">
      <div className="update-toast-content">
        <div className="update-toast-icon">⬆️</div>
        <div className="update-toast-text">
          <strong>发现新版本 {updateInfo.latestVersion}</strong>
          {updating ? (
            <div className="update-toast-progress">
              <div className="update-toast-progress-bar">
                <div className="update-toast-progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <span className="update-toast-percent">{progress}%</span>
            </div>
          ) : (
            <p>Kingdee Code 有新版本可用，是否立即更新？</p>
          )}
        </div>
      </div>
      {!updating && (
        <div className="update-toast-actions">
          <button className="update-toast-btn primary" onClick={handleUpdate}>立即更新</button>
          <button className="update-toast-btn" onClick={handleDismiss}>稍后再说</button>
        </div>
      )}
    </div>
  )
}

/* ── App ── */

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('chat')
  const openCodeSetup = useOpenCodeSetup()
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('kwork-theme') as 'dark' | 'light') || 'light'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('kwork-theme', theme)
  }, [theme])

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark')

  return (
    <div className="app">
      {/* 顶部导航栏 */}
      <header className="topbar">
        <div className="topbar-left" />

        <nav className="topbar-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              className={`tab-btn ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="topbar-right">
          <button
            className="theme-btn"
            title={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
            onClick={toggleTheme}
          >
            {theme === 'dark' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="5"/>
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            )}
          </button>
          <button
            className="devtools-btn"
            title="Toggle DevTools"
            onClick={() => (window as any).electronAPI?.toggleDevTools()}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1.5 1h13l.5.5v13l-.5.5h-13l-.5-.5v-13l.5-.5zM2 5v9h12V5H2zm0-1h12V2H2v2zm3-1H4V2h1v1zm2 0H6V2h1v1z"/>
            </svg>
          </button>
          <div className="user-avatar">U</div>
        </div>
      </header>

      {/* 主内容区 — 所有页签始终挂载，用 display 切换，避免 webview 重载 */}
      <main className="main-content">
        <ErrorBoundary>
          <div style={{ display: activeTab === 'chat' ? 'contents' : 'none' }}>
            <ChatTab />
          </div>
          <div style={{ display: activeTab === 'work' ? 'contents' : 'none' }}>
            <WorkTab />
          </div>
          <div style={{ display: activeTab === 'dev' ? 'contents' : 'none' }}>
            <DevTab setup={openCodeSetup} />
          </div>
        </ErrorBoundary>
      </main>

      {/* 右下角更新提示 */}
      <UpdateToast />
    </div>
  )
}

export default App
