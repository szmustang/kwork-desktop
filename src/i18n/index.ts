export type Lang = 'zh' | 'en'

const messages = {
  zh: {
    // tabs
    tabChat: '对话',
    tabWork: '工作',
    tabDev: '开发',
    // error boundary
    errorTitle: '页面出错了',
    errorRetry: '重试',
    // update toast
    updateNewVersion: '发现新版本',
    updateBuild: 'Build',
    updateClient: '灵基',
    updateDownloadFailed: '下载失败，请点击重试',
    updateDownloaded: '下载完成，点击「重启安装」应用更新',
    updateAvailable: '有新版本可用，是否立即更新？',
    updateNow: '立即更新',
    updateRestart: '重启安装',
    updateLater: '稍后再说',
    updateUpdatedTo: '已更新至',
    updateRelaunchHint: '重启以应用更新',
    updateRelaunch: '重启',
    // user dropdown
    fileTitle: '文件',
    notifyTitle: '通知',
    langSelect: '语言选择',
    langZh: '简体中文',
    langEn: 'English',
    logout: '退出登录',
    // confirm dialog
    logoutTitle: '退出登录',
    logoutMessage: '请确认是否退出登录',
    confirmOk: '确定',
    confirmCancel: '取消',
    // logout toast
    logoutSuccess: '已退出登录。',
    logoutError: '退出登录异常，请联系管理员。',
    // token expired dialog
    tokenExpiredTitle: '登录已过期',
    tokenExpiredMessage: '您的登录状态已过期，请重新登录。',
    // about dialog
    appName: '金蝶灵基',
    aboutUs: '关于我们',
    aboutWebsite: '官网',
    aboutTerms: '用户协议',
    aboutPrivacy: '隐私政策',
    comingSoon: '开发中，敬请期待...',
    // opencode setup
    setupNewVersion: '发现新版 Kingdee Code',
    setupDownloading: '正在下载 Kingdee Code，请稍候...',
    setupInstalling: '正在安装',
    setupInstallingDesc: '正在解压并安装 Kingdee Code 引擎...',
    setupStarting: '正在启动引擎',
    setupStartingDesc: '正在启动 Kingdee Code 引擎，请稍候...',
    setupNotInstalled: 'Kingdee Code 未安装',
    setupNotInstalledDesc: '开发页签需要 Kingdee Code 引擎支持。',
    setupNotInstalledHint: '请检查网络连接后重试。',
    setupRetryDownload: '重试下载',
    setupError: '出错了',
    setupRetry: '重试',
    setupStartFailed: '启动 Kingdee Code 服务失败',
    setupInstallFailed: '安装失败',
    // webview error overlay
    webviewNetworkError: '网络连接失败',
    webviewNetworkErrorDesc: '无法访问页面，请检查网络连接或代理设置后重试。',
    webviewLoadError: '页面加载失败',
    webviewLoadErrorDesc: '页面未能正常加载，请稍后重试。',
    webviewRetry: '重新加载',
  },
  en: {
    // tabs
    tabChat: 'Chat',
    tabWork: 'Work',
    tabDev: 'Dev',
    // error boundary
    errorTitle: 'Something went wrong',
    errorRetry: 'Retry',
    // update toast
    updateNewVersion: 'New version available',
    updateBuild: 'Build',
    updateClient: 'Client',
    updateDownloadFailed: 'Download failed, click to retry',
    updateDownloaded: 'Download complete, click "Restart to Install" to apply update',
    updateAvailable: 'A new version is available. Update now?',
    updateNow: 'Update Now',
    updateRestart: 'Restart to Install',
    updateLater: 'Later',
    updateUpdatedTo: 'Updated to',
    updateRelaunchHint: 'Relaunch to apply',
    updateRelaunch: 'Relaunch',
    // user dropdown
    fileTitle: 'Files',
    notifyTitle: 'Notifications',
    langSelect: 'Language',
    langZh: '简体中文',
    langEn: 'English',
    logout: 'Log Out',
    // confirm dialog
    logoutTitle: 'Log Out',
    logoutMessage: 'Are you sure you want to log out?',
    confirmOk: 'OK',
    confirmCancel: 'Cancel',
    // logout toast
    logoutSuccess: 'Successfully logged out.',
    logoutError: 'Logout failed, please contact admin.',
    // token expired dialog
    tokenExpiredTitle: 'Session Expired',
    tokenExpiredMessage: 'Your session has expired. Please log in again.',
    // about dialog
    appName: 'Kingdee Lingee',
    aboutUs: 'About Us',
    aboutWebsite: 'Website',
    aboutTerms: 'Terms of Service',
    aboutPrivacy: 'Privacy Policy',
    comingSoon: 'Coming soon, stay tuned...',
    // opencode setup
    setupNewVersion: 'New version of Kingdee Code found',
    setupDownloading: 'Downloading Kingdee Code, please wait...',
    setupInstalling: 'Installing',
    setupInstallingDesc: 'Extracting and installing Kingdee Code engine...',
    setupStarting: 'Starting Engine',
    setupStartingDesc: 'Starting Kingdee Code engine, please wait...',
    setupNotInstalled: 'Kingdee Code Not Installed',
    setupNotInstalledDesc: 'Dev tab requires Kingdee Code engine.',
    setupNotInstalledHint: 'Please check your network and retry.',
    setupRetryDownload: 'Retry Download',
    setupError: 'Error',
    setupRetry: 'Retry',
    setupStartFailed: 'Failed to start Kingdee Code service',
    setupInstallFailed: 'Installation failed',
    // webview error overlay
    webviewNetworkError: 'Network Connection Failed',
    webviewNetworkErrorDesc: 'Unable to load the page. Please check your network connection or proxy settings and try again.',
    webviewLoadError: 'Page Load Failed',
    webviewLoadErrorDesc: 'The page failed to load. Please try again later.',
    webviewRetry: 'Reload',
  },
} as const

export type MessageKey = keyof typeof messages.zh

export function t(lang: Lang, key: MessageKey): string {
  return messages[lang]?.[key] ?? messages.zh[key]
}
