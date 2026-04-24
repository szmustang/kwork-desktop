import { t, type Lang } from '../i18n'
import appIcon from '../../build/icon.png'

interface AboutDialogProps {
  visible: boolean
  onClose: () => void
  appVersion: string
  appName: string
  lang: Lang
}

export default function AboutDialog({ visible, onClose, appVersion, appName, lang }: AboutDialogProps) {
  if (!visible) return null

  return (
    <>
      <div className="about-dialog-overlay" onClick={onClose} />
      <div className="about-dialog">
        <button className="about-dialog-close" onClick={onClose}>
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
            <a href="https://dev.kingdee.com/kwc" target="_blank" rel="noopener noreferrer">{t(lang, 'aboutWebsite')}</a>
            <span className="about-links-sep" />
            <a href="https://dev.kingdee.com/kwc" target="_blank" rel="noopener noreferrer">{t(lang, 'aboutTerms')}</a>
            <span className="about-links-sep" />
            <a href="https://dev.kingdee.com/kwc" target="_blank" rel="noopener noreferrer">{t(lang, 'aboutPrivacy')}</a>
          </div>
          <div className="about-copyright">Copyright &copy; 2026 Kingdee. All rights reserved.</div>
        </div>
      </div>
    </>
  )
}
