// ===== 用户信息查询 API =====
// 鉴权方式：HMAC-SHA256 签名（在 Electron 主进程完成，密钥不暴露给渲染进程）
// 接口路径：/manage/api/users/backend/{id}

/** 用户信息响应（不脱敏） */
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

/**
 * 获取用户信息（不脱敏）
 *
 * 调用 GET /manage/api/users/backend/{id}
 * 鉴权：HMAC-SHA256 签名（在 Electron 主进程完成，密钥不出主进程）
 * 通过 lingeeBridge.fetchUserProfile IPC 调用主进程代理
 *
 * @param userId 用户ID
 * @throws {Error} 请求失败时抛出错误
 */
export async function fetchUserProfile(userId: string): Promise<UserProfileResponse> {
  const bridge = (window as any).lingeeBridge

  if (!bridge?.fetchUserProfile) {
    throw new Error('用户信息查询需要 Electron 主进程支持（lingeeBridge.fetchUserProfile 不可用）')
  }

  const res = await bridge.fetchUserProfile(userId)

  if (!res.ok) {
    if (res.status === 401) throw new Error('HMAC 签名校验失败')
    if (res.status === 403) throw new Error('权限不足')
    if (res.status === 404) throw new Error('用户不存在')
    throw new Error(res.error || `获取用户信息失败 (HTTP ${res.status})`)
  }

  return res.data as UserProfileResponse
}
