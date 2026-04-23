import type { OpenCodeAPI } from './opencode-api'
import { createRealAPI } from './real-api'

export type { OpenCodeAPI } from './opencode-api'
export * from './opencode-api'

let apiInstance: OpenCodeAPI | null = null

/**
 * 获取 API 实例（单例）
 * 连接到 opencode sidecar 服务
 */
export async function getAPI(): Promise<OpenCodeAPI> {
  if (apiInstance) return apiInstance

  // 尝试从 lingeeBridge preload 获取 server info
  const bridge = (window as unknown as Record<string, unknown>).lingeeBridge as
    | { getServerInfo?: () => Promise<{ url: string } | null> }
    | undefined

  if (bridge?.getServerInfo) {
    try {
      const info = await bridge.getServerInfo()
      if (info) {
        const realAPI = createRealAPI(info)
        const healthy = await realAPI.checkHealth()
        if (healthy) {
          console.log('[OpenCode] Connected to sidecar:', info.url)
          apiInstance = realAPI
          return apiInstance
        } else {
          console.warn('[OpenCode] Sidecar not healthy, retrying...')
        }
      }
    } catch (e) {
      console.warn('[OpenCode] Failed to connect to sidecar:', e)
    }
  }

  // 如果在浏览器环境（开发模式），直接连 localhost
  const directURL = 'http://127.0.0.1:4096'
  try {
    const directAPI = createRealAPI({ url: directURL })
    const healthy = await directAPI.checkHealth()
    if (healthy) {
      console.log('[OpenCode] Connected directly to:', directURL)
      apiInstance = directAPI
      return apiInstance
    }
  } catch {
    // ignore
  }

  throw new Error('无法连接到 Kingdee Code 服务。请确保服务正在运行。')
}

/**
 * 重置 API 实例（用于重连）
 */
export function resetAPI() {
  apiInstance = null
}
