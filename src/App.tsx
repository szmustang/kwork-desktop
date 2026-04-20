import { useState, useEffect, useCallback, useRef, Component, type ReactNode, type ErrorInfo } from 'react'
import LoginPage, { type UserInfo } from './components/LoginPage'
import UserDropdown from './components/UserDropdown'
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

const OPENCODE_CHECK_INTERVAL = 30 * 60 * 1000    // opencode: 30 分钟
const CLIENT_CHECK_INTERVAL = 60 * 60 * 1000      // 客户端: 1 小时
const OPENCODE_CHECK_DELAY = 5 * 60 * 1000        // opencode 首次检测延迟: 5 分钟
const CLIENT_CHECK_DELAY = 1 * 60 * 1000          // 客户端首次检测延迟: 1 分钟（测试用）

function UpdateToast() {
  const [updateInfo, setUpdateInfo] = useState<{ version: string; type: 'opencode' | 'client' } | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const relaunchingRef = useRef(false)  // 标记是否正在重启安装，防止 error 事件干扰
  const downloadingRef = useRef(false)  // 用 ref 跟踪下载状态，避免闭包捕获旧值

  // 检查 opencode 更新
  const checkOpencodeUpdate = useCallback(async () => {
    const api = (window as any).electronAPI
    if (!api?.checkPendingUpdate) return

    try {
      const result = await api.checkPendingUpdate()
      console.log('[UpdateToast] opencode check result:', JSON.stringify(result))
      if (result.hasUpdate && result.version && !updateInfo) {
        setUpdateInfo({ version: result.version, type: 'opencode' })
      }
    } catch (err) {
      console.warn('[UpdateToast] opencode check failed:', err)
    }
  }, [updateInfo])

  // 检查客户端更新
  const checkClientUpdate = useCallback(async () => {
    const api = (window as any).electronAPI
    if (!api?.checkForClientUpdate) return

    try {
      const result = await api.checkForClientUpdate()
      console.log('[UpdateToast] client check result:', JSON.stringify(result))
    } catch (err) {
      console.warn('[UpdateToast] client check failed:', err)
    }
  }, [])

  useEffect(() => {
    // 监听客户端更新事件
    const api = (window as any).electronAPI
    if (!api) return

    const removeAvailable = api.onClientUpdateAvailable?.((data: { version: string }) => {
      console.log('[UpdateToast] Client update available:', data.version)
      if (!updateInfo) {
        setUpdateInfo({ version: data.version, type: 'client' })
      }
    })

    const removeProgress = api.onClientDownloadProgress?.((data: { percent: number }) => {
      setDownloadProgress(data.percent)
    })

    const removeDownloaded = api.onClientUpdateDownloaded?.(() => {
      console.log('[UpdateToast] Client update downloaded')
      setDownloading(false)
      downloadingRef.current = false
      setDownloadProgress(100)
      setDownloadError(null)
      // 下载完成后不自动安装，等待用户点击「重启安装」按钮确认
    })

    const removeError = api.onClientUpdateError?.((error: string) => {
      console.error('[UpdateToast] Update error:', error)
      // 如果已经触发了 update-downloaded（正在重启），忽略后续 error
      if (relaunchingRef.current) {
        console.log('[UpdateToast] Ignoring error because relaunch is in progress')
        return
      }
      // 下载过程中的错误：不清除弹窗，显示错误状态让用户可以重试
      if (downloadingRef.current) {
        console.log('[UpdateToast] Download error, showing retry state')
        setDownloading(false)
        downloadingRef.current = false
        setDownloadError(error)
        return
      }
      setDownloading(false)
      setUpdateInfo(null)
    })

    return () => {
      removeAvailable?.()
      removeProgress?.()
      removeDownloaded?.()
      removeError?.()
    }
  }, [updateInfo])

  useEffect(() => {
    // opencode: 5 分钟后首次检查，之后每 30 分钟
    const opencodeTimer = setTimeout(checkOpencodeUpdate, OPENCODE_CHECK_DELAY)
    const opencodeInterval = setInterval(checkOpencodeUpdate, OPENCODE_CHECK_INTERVAL)
    
    // 客户端: 35 分钟后首次检查，之后每 1 小时（与 opencode 错开 30 分钟）
    const clientTimer = setTimeout(checkClientUpdate, CLIENT_CHECK_DELAY)
    const clientInterval = setInterval(checkClientUpdate, CLIENT_CHECK_INTERVAL)
    
    return () => {
      clearTimeout(opencodeTimer)
      clearInterval(opencodeInterval)
      clearTimeout(clientTimer)
      clearInterval(clientInterval)
    }
  }, [checkOpencodeUpdate, checkClientUpdate])

  const handleUpdate = () => {
    const api = (window as any).electronAPI
    if (!api) return
    
    // 根据更新类型执行不同操作
    if (updateInfo?.type === 'opencode') {
      // opencode 更新：重启应用即可（启动时会自动应用 pending.json）
      api.relaunchApp()
    } else if (updateInfo?.type === 'client') {
      // 已下载完成：用户确认后执行安装重启
      if (downloadProgress >= 100) {
        relaunchingRef.current = true
        api.installClientUpdate()
        return
      }
      // 客户端更新：下载安装包
      if (downloading) return // 防止重复点击
      
      setDownloading(true)
      downloadingRef.current = true
      setDownloadProgress(0)
      setDownloadError(null)
      
      api.downloadClientUpdate().then((result: any) => {
        if (result.success) {
          console.log('[UpdateToast] Download started')
        } else {
          console.error('[UpdateToast] Download failed:', result.error)
          setDownloading(false)
          downloadingRef.current = false
          setDownloadError(result.error)
        }
      }).catch((err: any) => {
        console.error('[UpdateToast] Download error:', err)
        setDownloading(false)
        downloadingRef.current = false
        setDownloadError(String(err))
      })
    }
  }

  const handleDismiss = () => {
    // 只关闭弹窗，不清除状态，30 分钟后检查时会自动再次弹出
    setUpdateInfo(null)
  }

  if (!updateInfo) return null

  const isOpencode = updateInfo.type === 'opencode'
  const isClientDownloaded = updateInfo.type === 'client' && downloadProgress >= 100

  return (
    <div className="update-toast">
      <div className="update-toast-content">
        <div className="update-toast-icon">⬆️</div>
        <div className="update-toast-text">
          <strong>发现新版本 {isOpencode ? 'Build' : '客户端'} {updateInfo.version}</strong>
          {downloading ? (
            <div className="update-toast-progress">
              <div className="update-toast-progress-bar">
                <div className="update-toast-progress-fill" style={{ width: `${downloadProgress}%` }} />
              </div>
              <span className="update-toast-percent">{downloadProgress}%</span>
            </div>
          ) : downloadError ? (
            <p style={{ color: '#e5534b' }}>下载失败，请点击重试</p>
          ) : isClientDownloaded ? (
            <p>下载完成，点击「重启安装」应用更新</p>
          ) : (
            <p>{isOpencode ? 'Kingdee Code' : 'Kingdee KWork'} 有新版本可用，是否立即更新？</p>
          )}
        </div>
      </div>
      {!downloading && (
        <div className="update-toast-actions">
          <button className="update-toast-btn primary" onClick={handleUpdate}>
            {isClientDownloaded ? '重启安装' : '立即更新'}
          </button>
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
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => {
    const api = (window as any).electronAPI
    api?.getAppVersion?.().then((v: string) => setAppVersion(v || ''))
    // 设置平台 CSS 类，用于区分 macOS/Windows 布局
    if (api?.platform) {
      document.documentElement.setAttribute('data-platform', api.platform)
    }
  }, [])

  // 登录状态管理
  const [user, setUser] = useState<UserInfo | null>(() => {
    try {
      const stored = localStorage.getItem('kwork-user')
      return stored ? JSON.parse(stored) : null
    } catch { return null }
  })

  const handleLogin = useCallback((userInfo: UserInfo) => {
    localStorage.setItem('kwork-user', JSON.stringify(userInfo))
    setUser(userInfo)
  }, [])

  const handleLogout = useCallback(() => {
    localStorage.removeItem('kwork-user')
    setUser(null)
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('kwork-theme', theme)
  }, [theme])

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark')

  // 未登录 → 显示登录页
  if (!user) {
    return <LoginPage onLogin={handleLogin} />
  }

  // 已登录 → 显示主界面
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
          <UserDropdown user={user} onLogout={handleLogout} theme={theme} onToggleTheme={toggleTheme} />
          {appVersion && <span className="app-version">v{appVersion}</span>}
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
