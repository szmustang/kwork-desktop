import { useState, useEffect, useCallback, useRef, Component, type ReactNode, type ErrorInfo } from 'react'
import LoginPage, { type UserInfo } from './components/LoginPage'
import UserDropdown from './components/UserDropdown'
import ChatTab from './components/ChatTab'
import WorkTab from './components/WorkTab'
import DevTab from './components/DevTab'
import { useOpenCodeSetup } from './components/dev/OpenCodeSetup'
import { fetchUserProfile } from './services/user-api'
import { logout } from './services/auth-api'
import { t, type Lang } from './i18n'
import AboutDialog from './components/AboutDialog'
import TopToast, { type ToastType } from './components/TopToast'
import './App.css'

// 错误边界：防止子组件崩溃导致整个页面白屏
class ErrorBoundary extends Component<{ children: ReactNode; lang: Lang }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('[ErrorBoundary]', error, info) }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, color: '#e5534b', textAlign: 'center' }}>
          <h3>{t(this.props.lang, 'errorTitle')}</h3>
          <p style={{ color: '#8b949e', margin: '8px 0 16px' }}>{this.state.error.message}</p>
          <button onClick={() => this.setState({ error: null })} style={{ padding: '8px 16px', cursor: 'pointer' }}>{t(this.props.lang, 'errorRetry')}</button>
        </div>
      )
    }
    return this.props.children
  }
}

type TabKey = 'chat' | 'work' | 'dev'

const tabKeys: TabKey[] = ['chat', 'work', 'dev']

/* ── 右下角更新提示弹窗 ── */

const CLIENT_CHECK_INTERVAL = 60 * 60 * 1000      // 客户端: 1 小时
const CLIENT_CHECK_DELAY = 1 * 60 * 1000          // 客户端首次检测延迟: 1 分钟

function UpdateToast({ lang }: { lang: Lang }) {
  const [updateInfo, setUpdateInfo] = useState<{ version: string; type: 'opencode' | 'client' } | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const relaunchingRef = useRef(false)
  const downloadingRef = useRef(false)

  // 监听主进程后台推送的 opencode 更新就绪事件（已预下载完成）
  useEffect(() => {
    const api = (window as any).lingeeBridge
    if (!api?.onOpencodeUpdateReady) return

    const removeOpencodeReady = api.onOpencodeUpdateReady((data: { version: string }) => {
      console.log('[UpdateToast] Opencode update ready (pre-downloaded):', data.version)
      if (!updateInfo) {
        setUpdateInfo({ version: data.version, type: 'opencode' })
      }
    })

    return () => removeOpencodeReady?.()
  }, [updateInfo])

  // 检查客户端更新
  const checkClientUpdate = useCallback(async () => {
    const api = (window as any).lingeeBridge
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
    const api = (window as any).lingeeBridge
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
    // 客户端: 1 分钟后首次检查，之后每 1 小时
    const clientTimer = setTimeout(checkClientUpdate, CLIENT_CHECK_DELAY)
    const clientInterval = setInterval(checkClientUpdate, CLIENT_CHECK_INTERVAL)
    
    return () => {
      clearTimeout(clientTimer)
      clearInterval(clientInterval)
    }
  }, [checkClientUpdate])

  const handleUpdate = () => {
    const api = (window as any).lingeeBridge
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
          <strong>{t(lang, 'updateNewVersion')} {isOpencode ? t(lang, 'updateBuild') : t(lang, 'updateClient')} {updateInfo.version}</strong>
          {downloading ? (
            <div className="update-toast-progress">
              <div className="update-toast-progress-bar">
                <div className="update-toast-progress-fill" style={{ width: `${downloadProgress}%` }} />
              </div>
              <span className="update-toast-percent">{downloadProgress}%</span>
            </div>
          ) : downloadError ? (
            <p style={{ color: '#e5534b' }}>{t(lang, 'updateDownloadFailed')}</p>
          ) : isClientDownloaded ? (
            <p>{t(lang, 'updateDownloaded')}</p>
          ) : (
            <p>{isOpencode ? 'Kingdee Code' : 'Kingdee Lingee'} {t(lang, 'updateAvailable')}</p>
          )}
        </div>
      </div>
      {!downloading && (
        <div className="update-toast-actions">
          <button className="update-toast-btn primary" onClick={handleUpdate}>
            {isClientDownloaded ? t(lang, 'updateRestart') : t(lang, 'updateNow')}
          </button>
          <button className="update-toast-btn" onClick={handleDismiss}>{t(lang, 'updateLater')}</button>
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
    return (localStorage.getItem('lingee-theme') as 'dark' | 'light') || 'light'
  })
  const [lang, setLang] = useState<Lang>(() => {
    return (localStorage.getItem('lingee-lang') as Lang) || 'zh'
  })
  const [appVersion, setAppVersion] = useState('')
  const [appName, setAppName] = useState('')
  const [triggerAbout, setTriggerAbout] = useState(false)

  useEffect(() => {
    const bridge = (window as any).lingeeBridge
    bridge?.getAppVersion?.().then((v: string) => setAppVersion(v || ''))
    bridge?.getAppName?.().then((n: string) => setAppName(n || ''))
    const cleanupAbout = bridge?.onShowAbout?.(() => setTriggerAbout(true))
    // 设置平台 CSS 类，用于区分 macOS/Windows 布局
    if (bridge?.platform) {
      document.documentElement.setAttribute('data-platform', bridge.platform)
    }
    return () => { cleanupAbout?.() }
  }, [])

  // 登录状态管理
  const [user, setUser] = useState<UserInfo | null>(() => {
    try {
      const stored = localStorage.getItem('lingee-user')
      if (!stored) return null
      const parsed: UserInfo = JSON.parse(stored)
      // token 过期检查：若已过期则清除登录状态
      if (parsed.expiresAt && Date.now() >= parsed.expiresAt) {
        console.warn('[Auth] Token expired, clearing session')
        localStorage.removeItem('lingee-user')
        return null
      }
      return parsed
    } catch { return null }
  })

  // 登录成功后，拉取用户真实信息（头像、显示名、角色等）
  const fetchAndMergeProfile = useCallback(async (userInfo: UserInfo) => {
    try {
      const profile = await fetchUserProfile(userInfo.userId, userInfo.token)
      console.log('[App] fetchUserProfile result:', profile)
      const merged: UserInfo = {
        ...userInfo,
        displayName: profile.displayName || profile.truename || userInfo.displayName,
        role: profile.role || userInfo.role,
        avatar: profile.avatar ?? userInfo.avatar,
        // 完整的用户档案字段
        truename: profile.truename ?? userInfo.truename,
        nickname: profile.nickname ?? userInfo.nickname,
        email: profile.email ?? userInfo.email,
        phone: profile.phone ?? userInfo.phone,
        gender: profile.gender ?? userInfo.gender,
      }
      localStorage.setItem('lingee-user', JSON.stringify(merged))
      setUser(merged)
    } catch (err) {
      console.warn('[App] fetchUserProfile failed, using login data:', err)
      localStorage.setItem('lingee-user', JSON.stringify(userInfo))
      setUser(userInfo)
    }
  }, [])

  const handleLogin = useCallback((userInfo: UserInfo) => {
    localStorage.setItem('lingee-user', JSON.stringify(userInfo))
    setUser(userInfo)
    // 异步拉取完整用户信息并更新
    fetchAndMergeProfile(userInfo)
  }, [fetchAndMergeProfile])

  // ── 登出 Toast 状态 ──
  const [logoutToast, setLogoutToast] = useState<{ type: ToastType; message: string } | null>(null)
  const logoutToastTimer = useRef<ReturnType<typeof setTimeout>>()

  const showLogoutToast = useCallback((type: ToastType, message: string) => {
    if (logoutToastTimer.current) clearTimeout(logoutToastTimer.current)
    setLogoutToast({ type, message })
    logoutToastTimer.current = setTimeout(() => setLogoutToast(null), 3000)
  }, [])

  useEffect(() => {
    return () => { if (logoutToastTimer.current) clearTimeout(logoutToastTimer.current) }
  }, [])

  // 用 ref 追踪最新的 user/lang，避免 handleLogout 依赖它们导致频繁重建
  const userRef = useRef(user)
  userRef.current = user
  const langRef = useRef(lang)
  langRef.current = lang

  const handleLogout = useCallback(async () => {
    const token = userRef.current?.token
    // 立即清除本地登录态
    localStorage.removeItem('lingee-user')
    setUser(null)
    try {
      if (token) await logout(token)
      showLogoutToast('success', t(langRef.current, 'logoutSuccess'))
    } catch {
      showLogoutToast('error', t(langRef.current, 'logoutError'))
    }
  }, [showLogoutToast])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('lingee-theme', theme)
  }, [theme])

  // ── 语言持久化 & 登录同步 ──
  useEffect(() => {
    localStorage.setItem('lingee-lang', lang)
  }, [lang])

  // 登录成功后，从 localStorage 同步 LoginPage 可能修改的语言偏好
  useEffect(() => {
    if (user) {
      const stored = (localStorage.getItem('lingee-lang') as Lang) || 'zh'
      setLang(stored)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const handleLangChange = useCallback((newLang: Lang) => {
    setLang(newLang)
  }, [])

  // ── LingeeBridge: 配置同步 ──
  // 当 theme / user / appVersion / lang 变化时，将完整 LingeeConfig 推送到主进程，主进程广播到所有 webview
  useEffect(() => {
    const bridge = (window as any).lingeeBridge
    if (!bridge?.updateBridgeConfig) return
    const language = lang === 'en' ? 'en-US' : 'zh-CN'
    bridge.updateBridgeConfig({
      language,
      theme,
      auth: user ? {
        token: user.token,
        tenantId: user.tenantId,
        tenantAccountId: user.tenantAccountId,
        userId: user.userId,
        role: user.role,
        displayName: user.displayName,
        expiresAt: user.expiresAt,
      } : null,
      hostVersion: appVersion || 'unknown',
    })
  }, [theme, user, appVersion, lang])

  // ── LingeeBridge: webview 事件监听 ──
  useEffect(() => {
    const bridge = (window as any).lingeeBridge
    const removeWebviewEvent = bridge?.onWebviewEvent?.((eventName: string, _data: any) => {
      if (eventName === 'token-expired') {
        // webview 报告 token 过期 → 清除登录状态，显示登录页
        handleLogout()
      }
    })
    return () => removeWebviewEvent?.()
  }, [handleLogout])

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark')

  // 登录后刷新/恢复时，如果缓存中没有 avatar 且未拉取过 profile，则拉一次用户信息
  const profileFetchedRef = useRef(false)
  useEffect(() => {
    if (user && !user.avatar && user.userId && user.token && !profileFetchedRef.current) {
      profileFetchedRef.current = true
      fetchAndMergeProfile(user)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // 仅首次挂载时执行

  // 未登录 → 显示登录页（仍需支持 About 弹窗）
  if (!user) {
    return (
      <>
        <LoginPage onLogin={handleLogin} />
        <AboutDialog visible={triggerAbout} onClose={() => setTriggerAbout(false)} appVersion={appVersion} appName={appName} lang={lang} />
        <TopToast visible={!!logoutToast} type={logoutToast?.type} message={logoutToast?.message ?? ''} />
      </>
    )
  }

  // 已登录 → 显示主界面
  return (
    <div className="app">
      {/* 顶部导航栏 */}
      <header className="topbar">
        <div className="topbar-left">
                                    <span className="logo-text"></span>
                </div>

        <nav className="topbar-tabs">
          {tabKeys.map((key) => (
            <button
              key={key}
              className={`tab-btn ${activeTab === key ? 'active' : ''}`}
              onClick={() => setActiveTab(key)}
            >
              {t(lang, key === 'chat' ? 'tabChat' : key === 'work' ? 'tabWork' : 'tabDev')}
            </button>
          ))}
        </nav>

        <div className="topbar-right">
          <UserDropdown user={user} onLogout={handleLogout} theme={theme} onToggleTheme={toggleTheme} appVersion={appVersion} appName={appName} externalShowAbout={triggerAbout} onAboutClosed={() => setTriggerAbout(false)} lang={lang} onLangChange={handleLangChange} />
        </div>
      </header>

      {/* 主内容区 — 所有页签始终挂载，用 display 切换，避免 webview 重载 */}
      <main className="main-content">
        <ErrorBoundary lang={lang}>
          <div style={{ display: activeTab === 'chat' ? 'contents' : 'none' }}>
            <ChatTab />
          </div>
          <div style={{ display: activeTab === 'work' ? 'contents' : 'none' }}>
            <WorkTab />
          </div>
          <div style={{ display: activeTab === 'dev' ? 'contents' : 'none' }}>
            <DevTab setup={openCodeSetup} lang={lang} />
          </div>
        </ErrorBoundary>
      </main>

      {/* 右下角更新提示 */}
      <UpdateToast lang={lang} />
      <TopToast visible={!!logoutToast} type={logoutToast?.type} message={logoutToast?.message ?? ''} />
    </div>
  )
}

export default App
