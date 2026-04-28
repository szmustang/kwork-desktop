import { useState, useEffect, useRef } from 'react'
import type { UserInfo } from './LoginPage'
import { t, type Lang } from '../i18n'
import AboutDialog from './AboutDialog'
import ConfirmDialog from './ConfirmDialog'
import DropdownPanel from './DropdownPanel'
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
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)

  const onAboutClosedRef = useRef(onAboutClosed)
  onAboutClosedRef.current = onAboutClosed

  useEffect(() => {
    if (externalShowAbout) {
      setShowAbout(true)
      onAboutClosedRef.current?.()
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

  const handleAboutClick = () => {
    setOpen(false)
    setShowLangSub(false)
    setShowAbout(true)
  }

  const handleLogoutClick = () => {
    setOpen(false)
    setShowLangSub(false)
    setShowLogoutConfirm(true)
  }

  const handleLogoutConfirm = () => {
    setShowLogoutConfirm(false)
    onLogout()
  }

  return (
    <div className="user-dropdown-wrapper">
      {/* 全屏透明遮罩：点击任意位置关闭下拉面板 */}
      {open && <div className="user-dropdown-overlay" onClick={() => { setOpen(false); setShowLangSub(false) }} />}

      {/* 文件夹图标 */}
      <button className="topbar-icon-btn" title={t(lang, 'fileTitle')}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <use href="/icons.svg#folder-open-icon" />
        </svg>
      </button>

      {/* 通知铃铛 */}
      <button className="topbar-icon-btn" title={t(lang, 'notifyTitle')}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <use href="/icons.svg#notification-icon" />
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
            <div className="user-dropdown-name" title={user.displayName}>{user.displayName}</div>
            <div className="user-dropdown-role" title={user.role}>{user.role}</div>
          </div>
          <div className="user-dropdown-divider" />
          {/* 语言选择 */}
          <div
            className="user-dropdown-action user-dropdown-lang-trigger"
            onClick={handleLangToggle}
          >
            <svg className="user-dropdown-action-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <g clipPath="url(#clip-globe-normal)">
                <path fillRule="evenodd" clipRule="evenodd" d="M7.99984 15.3333C12.0499 15.3333 15.3332 12.05 15.3332 7.99992C15.3332 3.94983 12.0499 0.666586 7.99984 0.666586C3.94975 0.666586 0.666504 3.94983 0.666504 7.99992C0.666504 12.05 3.94975 15.3333 7.99984 15.3333ZM6.01351 7.33325C6.07572 5.82909 6.34541 4.50268 6.73291 3.53377C6.9556 2.97704 7.20462 2.57074 7.44645 2.31502C7.68685 2.0609 7.87406 1.99992 7.99984 1.99992C8.12561 1.99992 8.31283 2.0609 8.55322 2.31502C8.79505 2.57074 9.04407 2.97704 9.26676 3.53377C9.65426 4.50268 9.92396 5.82909 9.98617 7.33325H6.01351ZM2.0376 7.33325C2.28473 5.09806 3.75927 3.2346 5.77262 2.42896C5.67325 2.62206 5.58031 2.82576 5.49528 3.03833C5.0355 4.1878 4.74234 5.6885 4.67952 7.33325H2.0376ZM11.3201 7.33325C11.2573 5.6885 10.9642 4.1878 10.5044 3.03833C10.4193 2.82566 10.3258 2.62214 10.2264 2.42896C12.24 3.23448 13.7149 5.09786 13.9621 7.33325H11.3201ZM5.77262 13.5715C3.75915 12.7659 2.28474 10.9019 2.0376 8.66659H4.67952C4.74234 10.3113 5.0355 11.812 5.49528 12.9615C5.58038 13.1743 5.67315 13.3783 5.77262 13.5715ZM7.99984 13.9999C7.87406 13.9999 7.68685 13.9389 7.44645 13.6848C7.20462 13.4291 6.9556 13.0228 6.73291 12.4661C6.34541 11.4972 6.07572 10.1708 6.01351 8.66659H9.98617C9.92396 10.1708 9.65426 11.4972 9.26676 12.4661C9.04407 13.0228 8.79505 13.4291 8.55322 13.6848C8.31283 13.9389 8.12561 13.9999 7.99984 13.9999ZM10.2264 13.5715C10.3259 13.3782 10.4192 13.1744 10.5044 12.9615C10.9642 11.812 11.2573 10.3113 11.3201 8.66659H13.9621C13.7149 10.9021 12.2402 12.7661 10.2264 13.5715Z" fill="black" fillOpacity="0.64"/>
              </g>
              <defs>
                <clipPath id="clip-globe-normal">
                  <rect width="16" height="16" fill="white" transform="matrix(1 0 0 -1 0 16)"/>
                </clipPath>
              </defs>
            </svg>
            <span className="user-dropdown-action-label">{lang === 'zh' ? t(lang, 'langZh') : t(lang, 'langEn')}</span>
            <svg className="user-dropdown-lang-arrow" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M5.86177 12.4715C6.12212 12.7318 6.54423 12.7318 6.80458 12.4715L10.8046 8.47149C11.0649 8.21114 11.0649 7.78903 10.8046 7.52868L6.80458 3.52868C6.54423 3.26833 6.12212 3.26833 5.86177 3.52868C5.60142 3.78903 5.60142 4.21114 5.86177 4.47149L9.39036 8.00008L5.86177 11.5287C5.60142 11.789 5.60142 12.2111 5.86177 12.4715Z" fill="black" fillOpacity="0.28"/>
            </svg>
            {/* 语言子面板：复用 DropdownPanel 组件 */}
            {showLangSub && (
              <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 0, left: 0 }}>
                <DropdownPanel
                  className="user-dropdown-lang-panel"
                  options={[
                    { key: 'zh', label: t(lang, 'langZh') },
                    { key: 'en', label: t(lang, 'langEn') },
                  ]}
                  value={lang}
                  onSelect={(key) => handleLangChange(key as Lang)}
                />
              </div>
            )}
          </div>
          {/* 关于我们 */}
          <div
            className="user-dropdown-action"
            onClick={handleAboutClick}
          >
            <svg className="user-dropdown-action-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path fillRule="evenodd" clipRule="evenodd" d="M8 14.5C11.5899 14.5 14.5 11.5899 14.5 8C14.5 4.41015 11.5899 1.5 8 1.5C4.41015 1.5 1.5 4.41015 1.5 8C1.5 11.5899 4.41015 14.5 8 14.5ZM8 16C12.4183 16 16 12.4183 16 8C16 3.58172 12.4183 0 8 0C3.58172 0 0 3.58172 0 8C0 12.4183 3.58172 16 8 16ZM8 6.5C8.41421 6.5 8.75 6.83579 8.75 7.25V11.25C8.75 11.6642 8.41421 12 8 12C7.58579 12 7.25 11.6642 7.25 11.25V7.25C7.25 6.83579 7.58579 6.5 8 6.5ZM8 4C7.44772 4 7 4.44772 7 5C7 5.55228 7.44772 6 8 6C8.55228 6 9 5.55228 9 5C9 4.44772 8.55228 4 8 4Z" fill="black" fillOpacity="0.64"/>
            </svg>
            <span className="user-dropdown-action-label">{t(lang, 'aboutUs')}</span>
          </div>
          {/* 退出登录 */}
          <button className="user-dropdown-logout" onClick={handleLogoutClick}>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
              <path d="M9.20438 1.6025C9.37969 1.29569 9.77061 1.18914 10.0775 1.36437C10.3106 1.49748 10.5351 1.64422 10.7494 1.80312C11.1161 2.07506 11.4537 2.38343 11.7569 2.7225C12.803 3.89249 13.44 5.43237 13.44 7.11875C13.4399 10.7944 10.4234 13.76 6.72 13.76C3.01659 13.76 0.000103848 10.7944 0 7.11875C0 5.43237 0.636958 3.89249 1.68313 2.7225C1.98634 2.38343 2.32388 2.07506 2.69062 1.80312C2.90494 1.64422 3.12941 1.49748 3.3625 1.36437C3.66939 1.18914 4.06031 1.29569 4.23562 1.6025C4.41086 1.90939 4.30431 2.30031 3.9975 2.47563C3.80864 2.58347 3.62673 2.70253 3.45312 2.83125C3.15602 3.05153 2.88229 3.30118 2.63687 3.57562C1.79117 4.52151 1.28 5.76114 1.28 7.11875C1.2801 10.0719 3.70777 12.48 6.72 12.48C9.73223 12.48 12.1599 10.0719 12.16 7.11875C12.16 5.76114 11.6488 4.52151 10.8031 3.57562C10.5577 3.30118 10.284 3.05153 9.98687 2.83125C9.81327 2.70253 9.63136 2.58347 9.4425 2.47563C9.13569 2.30031 9.02914 1.90939 9.20438 1.6025ZM6.72 0C7.07346 0 7.36 0.286538 7.36 0.64V7.04C7.36 7.39346 7.07346 7.68 6.72 7.68C6.36654 7.68 6.08 7.39346 6.08 7.04V0.64C6.08 0.286538 6.36654 0 6.72 0Z"/>
            </svg>
            <span className="user-dropdown-action-label">{t(lang, 'logout')}</span>
          </button>
        </div>
      )}

      {/* 关于弹窗 */}
      <AboutDialog visible={showAbout} onClose={() => setShowAbout(false)} appVersion={appVersion} appName={appName} lang={lang} />

      {/* 退出确认弹窗 */}
      <ConfirmDialog
        visible={showLogoutConfirm}
        title={t(lang, 'logoutTitle')}
        message={t(lang, 'logoutMessage')}
        confirmText={t(lang, 'confirmOk')}
        cancelText={t(lang, 'confirmCancel')}
        onConfirm={handleLogoutConfirm}
        onCancel={() => setShowLogoutConfirm(false)}
      />
    </div>
  )
}
