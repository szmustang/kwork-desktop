// ===== 用户信息查询 API =====

import { LINGEE_BASE_URL } from '../constants'

/** 用户信息响应（脱敏版） */
export interface UserProfileResponse {
  id: string
  tenant?: number
  tenantId?: string
  number?: string
  truename?: string
  displayName?: string
  nickname?: string
  username?: string
  phone?: string
  email?: string
  status?: string
  role?: string
  gender?: string
  birthday?: string
  avatar?: string
  dpt?: number
  position?: number
  sortcode?: string
  hiredate?: string
  enable?: string
  type?: string
  source?: string
  creator?: number
  timeCreated?: number
  modifier?: number
  timeUpdated?: number
}

/** 用户信息 API 基础 URL */
const USER_API_BASE_URL = LINGEE_BASE_URL

/**
 * 获取用户信息（脱敏版）
 *
 * 调用 GET /manage/api/users/{id}
 * 通过 lingeeBridge.proxyFetch 走主进程代理，绕过渲染进程 CORS 限制
 *
 * @param userId 用户ID
 * @param token  Bearer Token
 * @throws {Error} 请求失败时抛出错误
 */
export async function fetchUserProfile(userId: string, token: string): Promise<UserProfileResponse> {
  const url = `${USER_API_BASE_URL}/manage/api/users/${encodeURIComponent(userId)}`
  const bridge = (window as any).lingeeBridge

  // 优先使用主进程代理（解决 CORS / ERR_CONNECTION_CLOSED 问题）
  if (bridge?.proxyFetch) {
    const res = await bridge.proxyFetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    })

    if (!res.ok) {
      if (res.status === 401) throw new Error('认证失败，Token 无效或已过期')
      if (res.status === 403) throw new Error('权限不足')
      if (res.status === 404) throw new Error('用户不存在')
      throw new Error(res.error || `获取用户信息失败 (HTTP ${res.status})`)
    }

    // proxyFetch 返回的 body 是字符串，需要解析
    const contentType = res.headers?.['content-type'] || ''
    if (!contentType.includes('application/json')) {
      throw new Error(`响应格式异常，期望 JSON 但收到 ${contentType}`)
    }
    let raw: any
    try {
      raw = JSON.parse(res.body)
    } catch {
      throw new Error('响应格式异常，无法解析 JSON')
    }
    // 兼容包装格式：部分 API 返回 { code: 0, data: { ... } }，需要解包
    // 通过 !('id' in raw) 区分包装响应和直接返回的 profile 对象
    if (raw && typeof raw === 'object' && 'data' in raw && typeof raw.data === 'object' && raw.data !== null && !('id' in raw)) {
      return raw.data as UserProfileResponse
    }
    return raw as UserProfileResponse
  }

  // 回退：直接 fetch（非 Electron 环境）
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  })

  if (!res.ok) {
    if (res.status === 401) throw new Error('认证失败，Token 无效或已过期')
    if (res.status === 403) throw new Error('权限不足')
    if (res.status === 404) throw new Error('用户不存在')
    throw new Error(`获取用户信息失败 (HTTP ${res.status})`)
  }

  const raw = await res.json()
  // 兼容包装格式
  if (raw && typeof raw === 'object' && 'data' in raw && typeof raw.data === 'object' && raw.data !== null && !('id' in raw)) {
    return raw.data as UserProfileResponse
  }
  return raw as UserProfileResponse
}
