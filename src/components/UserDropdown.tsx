import { useState, useEffect } from 'react'
import type { UserInfo } from './LoginPage'
import appIcon from '../../build/icon.png'
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
}

export default function UserDropdown({ user, onLogout, theme, onToggleTheme, appVersion, appName, externalShowAbout, onAboutClosed }: UserDropdownProps) {
  const [open, setOpen] = useState(false)
  const [showAbout, setShowAbout] = useState(false)

  useEffect(() => {
    if (externalShowAbout) {
      setShowAbout(true)
      onAboutClosed?.()
    }
  }, [externalShowAbout])

  const initials = user.displayName.charAt(0).toUpperCase()

  return (
    <div className="user-dropdown-wrapper">
      {/* 全屏透明遮罩：点击任意位置关闭下拉面板 */}
      {open && <div className="user-dropdown-overlay" onClick={() => setOpen(false)} />}

      {/* 文件夹图标 */}
      <button className="topbar-icon-btn" title="文件">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
        </svg>
      </button>

      {/* 通知铃铛 */}
      <button className="topbar-icon-btn" title="通知">
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
        <img src={defaultAvatar} alt={initials} className="user-avatar-img" />
      </div>

      {/* 下拉面板 */}
      {open && (
        <div className="user-dropdown-panel">
          <div className="user-dropdown-info">
            <div className="user-dropdown-name">{user.displayName}</div>
            <div className="user-dropdown-role">{user.role}</div>
          </div>
          <div className="user-dropdown-divider" />
          <button className="user-dropdown-action" onClick={onToggleTheme}>
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
            <span>{theme === 'dark' ? '浅色模式' : '深色模式'}</span>
          </button>
          <button className="user-dropdown-action" onClick={() => (window as any).lingeeBridge?.toggleDevTools()}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1.5 1h13l.5.5v13l-.5.5h-13l-.5-.5v-13l.5-.5zM2 5v9h12V5H2zm0-1h12V2H2v2zm3-1H4V2h1v1zm2 0H6V2h1v1z"/>
            </svg>
            <span>开发者工具</span>
          </button>
          <button className="user-dropdown-action" onClick={() => { setOpen(false); setShowAbout(true); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12"/>
              <line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            <span>关于</span>
          </button>
          <div className="user-dropdown-divider" />
          <button className="user-dropdown-logout" onClick={onLogout}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span>退出登录</span>
          </button>
        </div>
      )}

      {/* 关于弹窗 */}
      {showAbout && (
        <>
          <div className="about-dialog-overlay" onClick={() => setShowAbout(false)} />
          <div className="about-dialog">
            <button className="about-dialog-close" onClick={() => setShowAbout(false)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
            <div className="about-dialog-content">
              <div className="about-logo">
                <img src={appIcon} alt="Lingee" className="about-logo-img" />
                <div className="about-logo-text">
                  <span className="about-product-name">{appName || 'Kingdee Lingee'}</span>
                </div>
              </div>
              {appVersion && (
                <div className="about-version-badge">v{appVersion}</div>
              )}
              <div className="about-links">
                <a href="https://dev.kingdee.com/kwc" target="_blank" rel="noopener noreferrer">官网</a>
                <span className="about-links-sep" />
                <a href="https://dev.kingdee.com/kwc" target="_blank" rel="noopener noreferrer">用户协议</a>
                <span className="about-links-sep" />
                <a href="https://dev.kingdee.com/kwc" target="_blank" rel="noopener noreferrer">隐私政策</a>
              </div>
              <div className="about-copyright">Copyright &copy; 2026 Kingdee. All rights reserved.</div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
