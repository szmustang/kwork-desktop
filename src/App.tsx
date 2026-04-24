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
        <div className="update-toast-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56" fill="none">
            <path d="M35.6014 6.08816e-06C36.38 6.08816e-06 37.159 0.000190868 37.9382 0.00456336C38.5943 0.00839055 39.2502 0.0166947 39.9058 0.0341856C41.3347 0.0730136 42.7771 0.156412 44.1907 0.410161C45.6246 0.667741 46.9589 1.08895 48.2615 1.75228C49.5417 2.40414 50.7141 3.25528 51.7296 4.27131C52.7451 5.28736 53.5968 6.45924 54.2486 7.7394C54.9114 9.04198 55.3321 10.3764 55.5896 11.8102C55.8439 13.2232 55.9279 14.6646 55.9667 16.094C55.9848 16.7496 55.9925 17.406 55.9964 18.0616C56.0013 18.8402 55.9998 19.6192 55.9998 20.3984V35.6014C55.9998 36.38 56.0007 37.159 55.9964 37.9382C55.9925 38.5943 55.9842 39.2502 55.9667 39.9058C55.9279 41.3348 55.8434 42.7771 55.5896 44.1908C55.332 45.6245 54.9119 46.959 54.2486 48.2615C53.5968 49.5417 52.7457 50.7141 51.7296 51.7296C50.7135 52.7451 49.5417 53.5968 48.2615 54.2487C46.959 54.9114 45.6245 55.332 44.1907 55.5896C42.7776 55.8439 41.3353 55.9279 39.9058 55.9667C39.2502 55.9848 38.5937 55.9925 37.9382 55.9964C37.1596 56.0013 36.3806 55.9998 35.6014 55.9998H20.3984C19.6197 55.9998 18.8408 56.0007 18.0616 55.9964C17.4055 55.9925 16.7496 55.9842 16.094 55.9667C14.6651 55.9279 13.2237 55.8434 11.8102 55.5896C10.3764 55.3321 9.04198 54.9119 7.7394 54.2487C6.45924 53.5968 5.28681 52.7456 4.27131 51.7296C3.25582 50.7136 2.40414 49.5417 1.75228 48.2615C1.0895 46.9589 0.667741 45.6246 0.410161 44.1908C0.155865 42.7776 0.0730135 41.3353 0.0341855 39.9058C0.0161483 39.2502 0.0083904 38.5937 0.00456321 37.9382C-0.000355632 37.1596 5.93989e-06 36.3806 5.93989e-06 35.6014V20.3984C5.94002e-06 19.6197 0.000188973 18.8408 0.00456321 18.0616C0.008392 17.4055 0.0166887 16.7496 0.0341855 16.094C0.0730161 14.6652 0.156448 13.2237 0.410161 11.8102C0.667734 10.3763 1.08894 9.04203 1.75228 7.7394C2.40415 6.45917 3.25522 5.28685 4.27131 4.27131C5.2874 3.25577 6.45917 2.40415 7.7394 1.75228C9.04203 1.08949 10.3763 0.667734 11.8102 0.410161C13.2232 0.155901 14.6646 0.0730162 16.094 0.0341856C16.7496 0.016142 17.406 0.00839196 18.0616 0.00456336C18.8402 -0.00035766 19.6192 5.90303e-06 20.3984 6.08816e-06H35.6014Z" fill="#EEF5FF"/>
            <g transform="translate(14,14)">
              <path d="M24.4999 16.3335C25.1443 16.3335 25.6666 16.8558 25.6666 17.5002V21.0002C25.6666 23.5775 23.5772 25.6668 20.9999 25.6668H6.99992C4.42259 25.6668 2.33325 23.5775 2.33325 21.0002V17.5002C2.33325 16.8558 2.85559 16.3335 3.49992 16.3335C4.14425 16.3335 4.66658 16.8558 4.66659 17.5002V21.0002C4.66659 22.2888 5.71125 23.3335 6.99992 23.3335H20.9999C22.2886 23.3335 23.3333 22.2888 23.3333 21.0002V17.5002C23.3333 16.8558 23.8556 16.3335 24.4999 16.3335Z" fill="#2363FA"/>
              <path d="M14.0181 2.3335C14.6623 2.33442 15.1843 2.85719 15.1837 3.5013L15.1689 15.4824L18.4752 12.5452C18.9568 12.1172 19.6934 12.1605 20.1215 12.6421C20.5494 13.1237 20.5062 13.8604 20.0247 14.2884L15.7055 18.1291C14.7331 18.9933 13.2668 18.9933 12.2944 18.1291L7.97518 14.2884C7.49368 13.8604 7.4505 13.1237 7.87834 12.6421C8.30641 12.1605 9.04308 12.1172 9.52466 12.5452L12.8355 15.487L12.8503 3.49902C12.8511 2.85478 13.3739 2.33286 14.0181 2.3335Z" fill="#2363FA"/>
            </g>
          </svg>
        </div>
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
          <button className="update-toast-btn" onClick={handleDismiss}>{t(lang, 'updateLater')}</button>
          <button className="update-toast-btn primary" onClick={handleUpdate}>
            {isClientDownloaded ? t(lang, 'updateRestart') : t(lang, 'updateNow')}
          </button>
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
