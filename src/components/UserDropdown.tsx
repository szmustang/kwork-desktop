import { useState, useEffect } from 'react'
import type { UserInfo } from './LoginPage'
import { t, type Lang } from '../i18n'
import AboutDialog from './AboutDialog'
import defaultAvatar from '../assets/linggeeuser.jpg'

interface UserDropdownProps {
  user: UserInfo
  onLogout: () => void
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  appVersion: string
  appName: string
  externalShowAbout?: boolean
  onAboutClosed?: () => void
  lang: Lang
  onLangChange: (lang: Lang) => void
}

export default function UserDropdown({ user, onLogout, theme, onToggleTheme, appVersion, appName, externalShowAbout, onAboutClosed, lang, onLangChange }: UserDropdownProps) {
  const [open, setOpen] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [showLangSub, setShowLangSub] = useState(false)

  useEffect(() => {
    if (externalShowAbout) {
      setShowAbout(true)
      onAboutClosed?.()
    }
  }, [externalShowAbout])

  const initials = user.displayName.charAt(0).toUpperCase()
  const avatarSrc = user.avatar || defaultAvatar

  const handleLangChange = (newLang: Lang) => {
    onLangChange(newLang)
    setShowLangSub(false)
    setOpen(false)
  }

  const handleLangToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowLangSub(v => !v)
  }

  return (
    <div className="user-dropdown-wrapper">
      {/* 全屏透明遮罩：点击任意位置关闭下拉面板 */}
      {open && <div className="user-dropdown-overlay" onClick={() => { setOpen(false); setShowLangSub(false) }} />}

      {/* 文件夹图标 */}
      <button className="topbar-icon-btn" title={t(lang, 'fileTitle')}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
        </svg>
      </button>

      {/* 通知铃铛 */}
      <button className="topbar-icon-btn" title={t(lang, 'notifyTitle')}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 01-3.46 0" />
        </svg>
      </button>

      {/* 用户头像 */}
      <div
        className={`user-avatar-btn ${open ? 'active' : ''}`}
        onClick={() => setOpen(!open)}
      >
        <img src={avatarSrc} alt={initials} className="user-avatar-img" />
      </div>

      {/* 下拉面板 */}
      {open && (
        <div className="user-dropdown-panel">
          <div className="user-dropdown-info">
            <div className="user-dropdown-name">{user.displayName}</div>
            <div className="user-dropdown-role">{user.role}</div>
          </div>
          <div className="user-dropdown-divider" />
          {/* 语言选择 */}
          <div
            className="user-dropdown-action user-dropdown-lang-trigger"
            onClick={handleLangToggle}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10A15.3 15.3 0 0112 2z" />
            </svg>
            <span>{t(lang, 'langSelect')}</span>
            <svg className="user-dropdown-lang-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M9 18l6-6-6-6" />
            </svg>
            {/* 语言子面板 */}
            {showLangSub && (
              <div
                className="user-dropdown-lang-sub"
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  className={`user-dropdown-lang-option ${lang === 'zh' ? 'active' : ''}`}
                  onClick={() => handleLangChange('zh')}
                >
                  <span>{t(lang, 'langZh')}</span>
                  {lang === 'zh' && (
                    <svg className="user-dropdown-lang-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1677ff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
                <div
                  className={`user-dropdown-lang-option ${lang === 'en' ? 'active' : ''}`}
                  onClick={() => handleLangChange('en')}
                >
                  <span>{t(lang, 'langEn')}</span>
                  {lang === 'en' && (
                    <svg className="user-dropdown-lang-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1677ff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
              </div>
            )}
          </div>
          {/* 退出登录 */}
          <button className="user-dropdown-logout" onClick={onLogout}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span>{t(lang, 'logout')}</span>
          </button>
        </div>
      )}

      {/* 关于弹窗 */}
      <AboutDialog visible={showAbout} onClose={() => setShowAbout(false)} appVersion={appVersion} appName={appName} lang={lang} />
    </div>
  )
}
