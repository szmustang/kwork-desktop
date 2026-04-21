import { useState, type FormEvent } from 'react'
import { login, AuthError } from '../services/auth-api'
import loginBg from '../assets/loginbg.png'
import '../styles/login-page.css'

export interface UserInfo {
  username: string
  displayName: string
  role: string
  token: string
  tenantId: string
  tenantAccountId: string
  userId: string
  expiresAt: number
}

interface LoginPageProps {
  onLogin: (user: UserInfo) => void
}

type Lang = 'zh' | 'en'

const i18n: Record<Lang, Record<string, string>> = {
  zh: {
    title: '登录使用完整功能',
    accountPlaceholder: '请输入账号',
    passwordPlaceholder: '请输入密码',
    forgotPassword: '忘记密码?',
    noAccount: '还没有账号？',
    register: '立即注册',
    login: '登录',
    loggingIn: '登录中...',
    agreementPrefix: '已阅读并同意',
    agreementLink: '《用户协议》',
    moreMethods: '更多登录方式',
    kdcloudLogin: '金蝶云账号登录',
    kdcloudLoggingIn: '金蝶云登录中...',
    errAccount: '请输入账号',
    errPassword: '请输入密码',
    errAgreement: '请先阅读并同意用户协议',
    errParamsEmpty: '用户名和密码不能为空',
    errAuthFailed: '用户名或密码错误',
    errAccountNotFound: '账号不存在',
    errNetwork: '网络连接失败，请稍后重试',
    errLoginFailed: '登录失败',
    errOAuth2Failed: 'OAuth2 登录失败',
    errOAuth2Timeout: '登录超时，请重试',
    close: '关闭',
    clear: '清除',
  },
  en: {
    title: 'Sign in to use full features',
    accountPlaceholder: 'Enter your account',
    passwordPlaceholder: 'Enter your password',
    forgotPassword: 'Forgot?',
    noAccount: "Don't have an account? ",
    register: 'Sign up',
    login: 'Sign In',
    loggingIn: 'Signing in...',
    agreementPrefix: 'I have read and agree to the ',
    agreementLink: 'User Agreement',
    moreMethods: 'More sign-in methods',
    kdcloudLogin: 'Kingdee Cloud Account',
    kdcloudLoggingIn: 'Signing in via Kingdee Cloud...',
    errAccount: 'Please enter your account',
    errPassword: 'Please enter your password',
    errAgreement: 'Please read and agree to the User Agreement',
    errParamsEmpty: 'Username and password are required',
    errAuthFailed: 'Invalid username or password',
    errAccountNotFound: 'Account does not exist',
    errNetwork: 'Network error, please try again later',
    errLoginFailed: 'Login failed',
    errOAuth2Failed: 'OAuth2 login failed',
    errOAuth2Timeout: 'Login timed out, please try again',
    close: 'Close',
    clear: 'Clear',
  },
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [lang, setLang] = useState<Lang>(() => {
    return (localStorage.getItem('lingee-lang') as Lang) || 'zh'
  })
  const t = i18n[lang]

  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [agreed, setAgreed] = useState(true)
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState(false)
  const [oauthError, setOauthError] = useState('')

  const switchLang = (newLang: Lang) => {
    setLang(newLang)
    localStorage.setItem('lingee-lang', newLang)
    setError('')
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    // 暂时跳过登录校验，直接进入主界面
    const user: UserInfo = {
      username: account.trim() || 'guest',
      displayName: account.trim() || 'Guest',
      role: 'User',
      token: '',
      tenantId: '',
      tenantAccountId: '',
      userId: '',
      expiresAt: Date.now() + 86400000,
    }
    onLogin(user)

    // --- 原始登录逻辑（暂时屏蔽）---
    // if (!agreed) {
    //   setError(t.errAgreement)
    //   return
    // }
    //
    // setLoading(true)
    // try {
    //   const res = await login({
    //     username: account.trim(),
    //     password: password.trim(),
    //   })
    //   const user: UserInfo = {
    //     username: account.trim(),
    //     displayName: res.displayName,
    //     role: res.role,
    //     token: res.token,
    //     tenantId: res.tenantId,
    //     tenantAccountId: res.tenantAccountId,
    //     userId: res.userId,
    //     expiresAt: res.expiresAt,
    //   }
    //   onLogin(user)
    // } catch (err) {
    //   if (err instanceof AuthError) {
    //     setError(`${t.errLoginFailed}：${err.message}`)
    //   } else {
    //     setError(t.errNetwork)
    //   }
    // } finally {
    //   setLoading(false)
    // }
  }

  const handleKdcloudLogin = async () => {
    setOauthError('')
    setError('')
    setOauthLoading(true)
    try {
      const api = (window as any).electronAPI
      if (!api?.oauth2Login) {
        setOauthError(t.errNetwork)
        return
      }
      const result = await api.oauth2Login()
      if (!result.success) {
        // 用户主动关闭授权窗口 → 静默恢复，不显示错误
        if (result.errorCode === 'CANCELLED') {
          return
        }
        // 按 errorCode 映射 i18n 文案，同时展示后端返回的具体错误信息
        const fallback = result.errorCode === 'TIMEOUT' ? t.errOAuth2Timeout : t.errOAuth2Failed
        const detail = result.error && result.error !== fallback ? `${t.errOAuth2Failed}：${result.error}` : fallback
        setOauthError(detail)
        console.error('[OAuth2]', result.error)
        return
      }
      const res = result.data
      // 防御性校验：确保关键字段存在，避免静默生成无效 UserInfo
      if (!res?.token || !res?.userId) {
        setOauthError(t.errOAuth2Failed)
        return
      }
      const user: UserInfo = {
        username: res.userId,
        displayName: res.displayName || '',
        role: res.role || '',
        token: res.token,
        tenantId: res.tenantId || '',
        tenantAccountId: res.tenantAccountId || '',
        userId: res.userId,
        expiresAt: res.expiresAt || 0,
      }
      onLogin(user)
    } catch (err) {
      console.error('[OAuth2] Exception:', err)
      setOauthError(t.errOAuth2Failed)
    } finally {
      setOauthLoading(false)
    }
  }

  const handleClearPassword = () => {
    setPassword('')
    setError('')
  }

  return (
    <div className="login-page" style={{ backgroundImage: `url(${loginBg})` }}>
      {/* 语言切换 */}
      <div className="login-lang-switcher">
        <button
          className={`login-lang-btn ${lang === 'zh' ? 'active' : ''}`}
          onClick={() => switchLang('zh')}
        >
          中文
        </button>
        <span className="login-lang-sep">/</span>
        <button
          className={`login-lang-btn ${lang === 'en' ? 'active' : ''}`}
          onClick={() => switchLang('en')}
        >
          EN
        </button>
      </div>

      <div className="login-card">
        <button
          className="login-close-btn"
          title={t.close}
          onClick={() => (window as any).electronAPI?.relaunchApp?.() || window.close()}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M1 1l12 12M13 1L1 13" />
          </svg>
        </button>

        <h2 className="login-title">{t.title}</h2>

        <form className="login-form" onSubmit={handleSubmit}>
          {/* 账号 */}
          <div className="login-input-group">
            <input
              className={`login-input ${error === t.errAccount ? 'error' : ''}`}
              type="text"
              placeholder={t.accountPlaceholder}
              value={account}
              onChange={(e) => { setAccount(e.target.value); setError('') }}
              autoFocus
            />
          </div>

          {/* 密码 */}
          <div className="login-input-group login-password-group">
            <input
              className={`login-input ${error && error === t.errPassword ? 'error' : ''}`}
              type={showPassword ? 'text' : 'password'}
              placeholder={t.passwordPlaceholder}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError('') }}
            />
            <div className="login-password-actions">
              {password && (
                <button type="button" className="login-clear-btn" onClick={handleClearPassword} title={t.clear}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z" />
                  </svg>
                </button>
              )}
              <span className="login-forgot-link" onClick={() => setShowPassword(!showPassword)}>
                {t.forgotPassword}
              </span>
            </div>
          </div>

          {/* 错误提示（固定占位） */}
          <div className="login-error-msg" style={{ visibility: error ? 'visible' : 'hidden' }}>
            <svg className="login-error-icon" viewBox="0 0 16 16" fill="#ef4444">
              <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.75 4a.75.75 0 011.5 0v3.5a.75.75 0 01-1.5 0V5zm.75 7a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
            <span className="login-error-text" title={error || ''}>{error || '\u00A0'}</span>
          </div>

          {/* 登录按钮 */}
          <button className="login-submit-btn" type="submit" disabled={loading || oauthLoading} style={{ marginTop: 8 }}>
            {loading ? t.loggingIn : t.login}
          </button>

          {/* 用户协议 */}
          <label className="login-agreement">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span>{t.agreementPrefix}</span>
            <a className="login-agreement-link" href="#agreement" onClick={(e) => e.preventDefault()}>
              {t.agreementLink}
            </a>
          </label>

          {/* 分隔线 */}
          <div className="login-divider">
            <span className="login-divider-text">{t.moreMethods}</span>
          </div>

          {/* 金蝶云账号登录 */}
          <button type="button" className="login-kdcloud-btn" onClick={handleKdcloudLogin} disabled={loading || oauthLoading}>
            <svg className="login-kdcloud-svg" xmlns="http://www.w3.org/2000/svg" width="14" height="20" viewBox="0 0 14 20" fill="none">
              <path fillRule="evenodd" clipRule="evenodd" d="M4.01052 8.23615C4.01052 9.34548 3.11271 10.2448 2.00532 10.2448C0.897811 10.2448 0 9.34548 0 8.23615C0 7.12682 0.897811 6.22754 2.00532 6.22754C3.11271 6.22754 4.01052 7.12682 4.01052 8.23615Z" fill="#46CBFF"/>
              <path fillRule="evenodd" clipRule="evenodd" d="M9.47918 13.4454C9.47918 14.7026 8.4617 15.7217 7.20644 15.7217C5.95131 15.7217 4.93384 14.7026 4.93384 13.4454C4.93384 12.1882 5.95131 11.1689 7.20644 11.1689C8.4617 11.1689 9.47918 12.1882 9.47918 13.4454Z" fill="#43C7C8"/>
              <path fillRule="evenodd" clipRule="evenodd" d="M7.19402 0C8.85517 0 10.202 1.36054 10.202 3.03873C10.202 4.71704 8.85517 6.07745 7.19402 6.07745C5.53275 6.07745 4.18604 4.71704 4.18604 3.03873C4.18604 1.36054 5.53275 0 7.19402 0Z" fill="#3C84F1"/>
              <path fillRule="evenodd" clipRule="evenodd" d="M13.75 18.6613C13.75 19.4008 13.1516 20.0002 12.4132 20.0002C11.6749 20.0002 11.0763 19.4008 11.0763 18.6613C11.0763 17.9217 11.6749 17.3223 12.4132 17.3223C13.1516 17.3223 13.75 17.9217 13.75 18.6613Z" fill="#9D6DFF"/>
            </svg>
            {oauthLoading ? t.kdcloudLoggingIn : t.kdcloudLogin}
          </button>

          {/* OAuth2 错误提示（固定占位） */}
          <div className="login-error-msg" style={{ marginTop: 8, visibility: oauthError ? 'visible' : 'hidden' }}>
            <svg className="login-error-icon" viewBox="0 0 16 16" fill="#ef4444">
              <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.75 4a.75.75 0 011.5 0v3.5a.75.75 0 01-1.5 0V5zm.75 7a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
            <span className="login-error-text" title={oauthError || ''}>{oauthError || '\u00A0'}</span>
          </div>
        </form>
      </div>
    </div>
  )
}
