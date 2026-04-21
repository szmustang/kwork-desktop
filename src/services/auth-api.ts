// ===== 登录认证 API =====

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
const AUTH_BASE_URL = 'https://devtest.kingdee.com'

/**
 * 调用 POST /auth/login 进行登录
 *
 * @throws {AuthError} 服务端返回的业务错误（40000/40001/40002）
 * @throws {Error}     网络异常等非预期错误
 */
export async function login(req: LoginRequest): Promise<LoginResponse> {
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
