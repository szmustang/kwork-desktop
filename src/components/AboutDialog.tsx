import { useEffect, useRef, useState } from 'react'
import { t, type Lang } from '../i18n'
import appIcon from '../../build/icon.png'
import TopToast from './TopToast'

interface AboutDialogProps {
  visible: boolean
  onClose: () => void
  appVersion: string
  appName: string
  lang: Lang
}

export default function AboutDialog({ visible, onClose, appVersion, appName, lang }: AboutDialogProps) {
  const [showComingSoon, setShowComingSoon] = useState(false)
  const comingSoonTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleComingSoon = () => {
    setShowComingSoon(true)
    if (comingSoonTimer.current) clearTimeout(comingSoonTimer.current)
    comingSoonTimer.current = setTimeout(() => setShowComingSoon(false), 3000)
  }

  useEffect(() => {
    return () => {
      if (comingSoonTimer.current) clearTimeout(comingSoonTimer.current)
    }
  }, [])

  // 弹窗关闭时一并清除 toast，避免残留
  useEffect(() => {
    if (!visible) {
      setShowComingSoon(false)
      if (comingSoonTimer.current) clearTimeout(comingSoonTimer.current)
    }
  }, [visible])

  if (!visible) return null

  return (
    <>
      <TopToast visible={showComingSoon} type="info" message={t(lang, 'comingSoon')} />
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
              <span className="about-product-name">{t(lang, 'appName')}</span>
            </div>
          </div>
          {appVersion && (
            <div className="about-version-badge">v{appVersion}</div>
          )}
          <div className="about-links">
            <a href="#about-website" onClick={(e) => { e.preventDefault(); handleComingSoon() }}>{t(lang, 'aboutWebsite')}</a>
            <span className="about-links-sep" />
            <a href="#about-terms" onClick={(e) => { e.preventDefault(); handleComingSoon() }}>{t(lang, 'aboutTerms')}</a>
            <span className="about-links-sep" />
            <a href="#about-privacy" onClick={(e) => { e.preventDefault(); handleComingSoon() }}>{t(lang, 'aboutPrivacy')}</a>
          </div>
          <div className="about-copyright">Copyright &copy; 2026 Kingdee. All rights reserved.</div>
        </div>
      </div>
    </>
  )
}
