import { useState, useEffect, useCallback, useRef, Component, type ReactNode, type ErrorInfo } from 'react'
import LoginPage, { type UserInfo } from './components/LoginPage'
import UserDropdown from './components/UserDropdown'
import ChatTab from './components/ChatTab'
import WorkTab from './components/WorkTab'
import DevTab from './components/DevTab'
import { useOpenCodeSetup } from './components/dev/OpenCodeSetup'
import { fetchUserProfile } from './services/user-api'
import { logout } from './services/auth-api'
import { trackUserLogin } from './services/tracking'
import { t, type Lang } from './i18n'
import AboutDialog from './components/AboutDialog'
import TopToast, { type ToastType } from './components/TopToast'
import ConfirmDialog from './components/ConfirmDialog'
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

/* ── 顶部页签导航（纯 CSS 滑块动画，零 DOM 操作） ── */
function TabNav({ activeTab, lang, onTabChange }: { activeTab: TabKey; lang: Lang; onTabChange: (k: TabKey) => void }) {
  const tabIndex = tabKeys.indexOf(activeTab)

  return (
    <nav className="topbar-tabs">
      <div className="tab-slider" style={{ transform: `translate3d(${tabIndex * 100}%, 0, 0)` }} />
      {tabKeys.map((key) => (
        <button
          key={key}
          className={`tab-btn ${activeTab === key ? 'active' : ''}`}
          onClick={() => onTabChange(key)}
        >
          {t(lang, key === 'chat' ? 'tabChat' : key === 'work' ? 'tabWork' : 'tabDev')}
        </button>
      ))}
    </nav>
  )
}

/* ── 左下角更新提示弹窗 ── */

function UpdateToast({ lang }: { lang: Lang }) {
  const [updateInfo, setUpdateInfo] = useState<{ version: string; type: 'opencode' | 'client' } | null>(null)

  // 监听主进程后台推送的 opencode 更新就绪事件（已预下载完成）
  useEffect(() => {
    const api = (window as any).lingeeBridge
    if (!api?.onOpencodeUpdateReady) return

    const removeOpencodeReady = api.onOpencodeUpdateReady((data: { version: string }) => {
      if (!updateInfo) {
        setUpdateInfo({ version: data.version, type: 'opencode' })
      }
    })

    return () => removeOpencodeReady?.()
  }, [updateInfo])

  // 监听客户端更新事件（后台静默下载完成后才通知）
  useEffect(() => {
    const api = (window as any).lingeeBridge
    if (!api) return

    const removeDownloaded = api.onClientUpdateDownloaded?.((data: { version: string }) => {
      if (!updateInfo) {
        setUpdateInfo({ version: data?.version || 'unknown', type: 'client' })
      }
    })

    return () => {
      removeDownloaded?.()
    }
  }, [updateInfo])

  const handleUpdate = () => {
    const api = (window as any).lingeeBridge
    if (!api) return
    
    // 两种更新类型都是已下载完成状态，点击即重启安装
    if (updateInfo?.type === 'opencode') {
      // opencode 更新：重启应用即可（启动时会自动应用 pending.json）
      api.relaunchApp()
    } else if (updateInfo?.type === 'client') {
      // 客户端更新：已下载完成，直接安装重启
      api.installClientUpdate()
    }
  }

  const handleDismiss = () => {
    setUpdateInfo(null)
  }

  if (!updateInfo) return null

  const titleText = `${t(lang, 'updateUpdatedTo')} V${updateInfo.version}`

  return (
    <div className="update-toast">
      <div className="update-toast-header">
        <div className="update-toast-title" title={titleText}>
          <span className="update-toast-title-label">{t(lang, 'updateUpdatedTo')}</span>
          <span className="update-toast-title-version">V{updateInfo.version}</span>
        </div>
        <button className="update-toast-close" onClick={handleDismiss} title={t(lang, 'updateSkip')}>
          <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path fillRule="evenodd" clipRule="evenodd" d="M0.195262 0.195262C0.455612 -0.0650874 0.877722 -0.0650874 1.13807 0.195262L4 3.05719L6.86193 0.195262C7.12228 -0.0650874 7.54439 -0.0650874 7.80474 0.195262C8.06509 0.455612 8.06509 0.877722 7.80474 1.13807L4.94281 4L7.80474 6.86193C8.06509 7.12228 8.06509 7.54439 7.80474 7.80474C7.54439 8.06509 7.12228 8.06509 6.86193 7.80474L4 4.94281L1.13807 7.80474C0.877722 8.06509 0.455612 8.06509 0.195262 7.80474C-0.0650874 7.54439 -0.0650874 7.12228 0.195262 6.86193L3.05719 4L0.195262 1.13807C-0.0650874 0.877722 -0.0650874 0.455612 0.195262 0.195262Z" fill="currentColor"/>
          </svg>
        </button>
      </div>
      <p className="update-toast-hint" title={t(lang, 'updateRelaunchHint')}>{t(lang, 'updateRelaunchHint')}</p>
      <div className="update-toast-actions">
        <span className="update-toast-skip" onClick={handleDismiss} title={t(lang, 'updateSkip')}>{t(lang, 'updateSkip')}</span>
        <button className="update-toast-restart-btn" onClick={handleUpdate} title={t(lang, 'updateRelaunch')}>{t(lang, 'updateRelaunch')}</button>
      </div>
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

    // 整窗四角圆角：仅 macOS，且窗口处于非最大化/非全屏状态时启用。
    // 主进程会广播状态变化；这里把状态写到 <html data-rounded> 驱动 CSS。
    const applyRounded = (rounded: boolean) => {
      document.documentElement.setAttribute('data-rounded', rounded ? 'true' : 'false')
    }
    let cleanupRounded: (() => void) | undefined
    if (bridge?.platform === 'darwin') {
      bridge?.getWindowRoundedState?.().then((v: boolean) => applyRounded(!!v)).catch(() => {})
      cleanupRounded = bridge?.onWindowRoundedStateChange?.((v: boolean) => applyRounded(!!v))
    } else {
      applyRounded(false)
    }

    return () => { cleanupAbout?.(); cleanupRounded?.() }
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
      const profile = await fetchUserProfile(userInfo.userId)
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

  // ── 通用 Toast 状态 ──
  const [toast, setToast] = useState<{ type: ToastType; message: string } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()

  const showToast = useCallback((type: ToastType, message: string, duration = 3000) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ type, message })
    toastTimer.current = setTimeout(() => setToast(null), duration)
  }, [])

  useEffect(() => {
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current) }
  }, [])

  const handleLogin = useCallback((userInfo: UserInfo) => {
    localStorage.setItem('lingee-user', JSON.stringify(userInfo))
    setUser(userInfo)
    // 异步拉取完整用户信息并更新
    fetchAndMergeProfile(userInfo)
    // 登录埋点（fire-and-forget，不阻塞 UI）
    trackUserLogin({ userId: userInfo.userId || '', tenantId: userInfo.tenantId || '' })
  }, [fetchAndMergeProfile])

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
      showToast('success', t(langRef.current, 'logoutSuccess'))
    } catch {
      showToast('error', t(langRef.current, 'logoutError'))
    }
  }, [showToast])

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

  // ── Token 过期确认弹窗状态 ──
  const [showTokenExpiredDialog, setShowTokenExpiredDialog] = useState(false)

  const handleTokenExpiredConfirm = useCallback(() => {
    setShowTokenExpiredDialog(false)
    handleLogout()
  }, [handleLogout])

  const handleTokenExpiredCancel = useCallback(() => {
    setShowTokenExpiredDialog(false)
  }, [])

  // ── LingeeBridge: webview 事件监听 ──
  useEffect(() => {
    const bridge = (window as any).lingeeBridge
    const removeWebviewEvent = bridge?.onWebviewEvent?.((eventName: string, _data: any) => {
      if (eventName === 'token-expired') {
        // webview 报告 token 过期 → 弹窗提示用户确认后再登出
        setShowTokenExpiredDialog(true)
      }
    })
    return () => removeWebviewEvent?.()
  }, [])

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
        <TopToast visible={!!toast} type={toast?.type} message={toast?.message ?? ''} />
        <ConfirmDialog
          visible={showTokenExpiredDialog}
          title={t(lang, 'tokenExpiredTitle')}
          message={t(lang, 'tokenExpiredMessage')}
          confirmText={t(lang, 'confirmOk')}
          cancelText={t(lang, 'confirmCancel')}
          onConfirm={handleTokenExpiredConfirm}
          onCancel={handleTokenExpiredCancel}
        />
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

        <TabNav activeTab={activeTab} lang={lang} onTabChange={setActiveTab} />

        <div className="topbar-right">
          <UserDropdown user={user} onLogout={handleLogout} theme={theme} onToggleTheme={toggleTheme} appVersion={appVersion} appName={appName} externalShowAbout={triggerAbout} onAboutClosed={() => setTriggerAbout(false)} lang={lang} onLangChange={handleLangChange} />
        </div>
      </header>

      {/* 主内容区 — 所有页签始终挂载，用 display 切换，避免 webview 重载 */}
      <main className="main-content">
        <ErrorBoundary lang={lang}>
          <div style={{ display: activeTab === 'chat' ? 'contents' : 'none' }}>
            <ChatTab lang={lang} />
          </div>
          <div style={{ display: activeTab === 'work' ? 'contents' : 'none' }}>
            <WorkTab lang={lang} />
          </div>
          <div style={{ display: activeTab === 'dev' ? 'contents' : 'none' }}>
            <DevTab setup={openCodeSetup} lang={lang} />
          </div>
        </ErrorBoundary>
      </main>

      {/* 右下角更新提示 */}
      <UpdateToast lang={lang} />
      <TopToast visible={!!toast} type={toast?.type} message={toast?.message ?? ''} />
      <ConfirmDialog
        visible={showTokenExpiredDialog}
        title={t(lang, 'tokenExpiredTitle')}
        message={t(lang, 'tokenExpiredMessage')}
        confirmText={t(lang, 'confirmOk')}
        cancelText={t(lang, 'confirmCancel')}
        onConfirm={handleTokenExpiredConfirm}
        onCancel={handleTokenExpiredCancel}
      />
    </div>
  )
}

export default App
