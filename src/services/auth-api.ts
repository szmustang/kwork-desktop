// ===== 登录认证 API =====

import { LINGEE_BASE_URL } from '../constants'

/** 登录请求参数 */
export interface LoginRequest {
  username: string
  password: string
}

/** 登录成功响应 */
export interface LoginResponse {
  ok: boolean
  error_code: string
  token: string
  tenantId: string
  tenantAccountId: string
  userId: string
  role: string
  displayName: string
  expiresAt: number
  ticket?: string  // OAuth2 登录时返回
}

/** 登录失败响应 */
export interface LoginErrorBody {
  error_message?: string
  error_code?: string
  message?: string
  code?: string
}

/** 认证错误（携带 error_code 和 HTTP 状态码） */
export class AuthError extends Error {
  constructor(
    message: string,
    public readonly errorCode: string,
    public readonly statusCode: number,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

/** 认证 API 基础 URL */
const AUTH_BASE_URL = LINGEE_BASE_URL

// ===== DEV ONLY: 模拟登录账号（后端接口不稳定时使用，正式上线前删除） =====
const MOCK_ACCOUNT = '17299999999'
const MOCK_PASSWORD = '123456'

function createMockLoginResponse(): LoginResponse {
  return {
    ok: true,
    error_code: '0',
    token: `mock-token-${Date.now()}`,
    tenantId: 'mock-tenant-001',
    tenantAccountId: 'mock-tenant-account-001',
    userId: 'mock-user-001',
    role: 'admin',
    displayName: '测试账号',
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7天后过期
  }
}
// ===== END DEV ONLY =====

/**
 * 调用 POST /auth/login 进行登录
 *
 * @throws {AuthError} 服务端返回的业务错误（40000/40001/40002）
 * @throws {Error}     网络异常等非预期错误
 */
export async function login(req: LoginRequest): Promise<LoginResponse> {
  // DEV ONLY: 假账号直接返回模拟数据，正式上线前删除
  if (req.username === MOCK_ACCOUNT && req.password === MOCK_PASSWORD) {
    console.warn('[Auth] 使用模拟登录账号，正式上线前请删除此逻辑')
    return createMockLoginResponse()
  }

  const res = await fetch(`${AUTH_BASE_URL}/openwork/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    credentials: 'include', // 携带 HttpOnly Cookie
  })

  if (!res.ok) {
    let body: LoginErrorBody
    try {
      body = await res.json()
    } catch {
      throw new AuthError('服务器响应异常', 'UNKNOWN', res.status)
    }
    throw new AuthError(
      body.error_message || body.message || '登录失败',
      body.error_code || body.code || 'UNKNOWN',
      res.status,
    )
  }

  const data = await res.json()
  if (!data.ok || (data.error_code && data.error_code !== '0') || (data.code && data.code !== '0')) {
    throw new AuthError(
      data.error_message || data.message || '登录失败',
      data.error_code || data.code || 'UNKNOWN',
      res.status,
    )
  }
  return data
}

/**
 * 调用 POST /auth/logout 进行登出
 *
 * @param token 用户的认证 token
 * @throws {Error} 网络异常或服务端返回非 2xx
 */
export async function logout(token: string): Promise<void> {
  const res = await fetch(`${AUTH_BASE_URL}/openwork/auth/logout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({}),
    credentials: 'include',
  })

  if (!res.ok) {
    throw new Error(`Logout failed with status ${res.status}`)
  }
}
