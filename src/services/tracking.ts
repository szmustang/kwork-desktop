/**
 * Lingee 埋点服务 - 渲染进程侧
 * 
 * 通过 IPC 将埋点数据发送到主进程处理（签名、哈希、重试、缓存等）
 * 所有调用均为 fire-and-forget，不影响 UI 渲染
 */

/**
 * 发送登录埋点
 * 设备信息（device_id, os, os_version, os_arch, app_version, code_version）
 * 由主进程 tracking.cjs 自动填充，渲染进程无需关心
 */
export async function trackUserLogin(userInfo: {
  userId: string
  tenantId: string
}): Promise<void> {
  try {
    const result = await (window as any).lingeeBridge.sendTrackingEvent({
      event_name: 'user_login',
      event_time: Date.now(),
      user_id: userInfo.userId || '',
      tenant_id: userInfo.tenantId || '',
      var: {
        source: 'shell',
      }
    })

    if (result && result.success) {
      console.log('[Tracking] 埋点上报成功', result.data ? JSON.stringify(result.data) : '')
    } else {
      const errorMsg = result?.error || '未知错误'
      const cached = result?.cached ? '（已缓存到本地，下次启动将重试）' : ''
      console.warn('[Tracking] 埋点上报失败', errorMsg, cached)
    }
  } catch (err: any) {
    console.error('[Tracking] 埋点上报异常', err?.message || String(err))
  }
}
