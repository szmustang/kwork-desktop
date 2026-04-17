import type {
  OpenCodeAPI,
  ServerInfo,
  Session,
  Message,
  MessageWrapper,
  SendMessageInput,
  OpenCodeEvent,
  OpenCodeConfig,
} from './opencode-api'
import { wrapperToMessage, toSendMessageBody } from './opencode-api'

/**
 * 真实 OpenCode Server API 客户端
 * 通过 HTTP REST + SSE 与 sidecar 通信
 */
export function createRealAPI(serverInfo: ServerInfo): OpenCodeAPI {
  const { url, token } = serverInfo

  const headers = (): HeadersInit => ({
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  })

  const request = async <T>(path: string, options?: RequestInit): Promise<T> => {
    const method = options?.method || 'GET'
    const start = performance.now()
    console.log(`[API] ${method} ${path} →`)
    const res = await fetch(`${url}${path}`, {
      ...options,
      headers: { ...headers(), ...options?.headers },
    })
    if (!res.ok) {
      const elapsed = (performance.now() - start).toFixed(0)
      console.log(`[API] ${method} ${path} ← ${res.status} ERR (${elapsed}ms)`)
      throw new Error(`API error ${res.status}: ${await res.text()}`)
    }
    const text = await res.text()
    const elapsed = (performance.now() - start).toFixed(0)
    console.log(`[API] ${method} ${path} ← ${res.status} OK (${elapsed}ms)`)
    return text ? JSON.parse(text) : undefined
  }

  return {
    // Session
    async listSessions() {
      return request<Session[]>('/session')
    },
    async createSession() {
      return request<Session>('/session', {
        method: 'POST',
        body: JSON.stringify({}),
      })
    },
    async getSession(sessionID) {
      return request<Session>(`/session/${sessionID}`)
    },
    async deleteSession(sessionID) {
      await request(`/session/${sessionID}`, { method: 'DELETE' })
    },

    // Messages - API returns MessageWrapper[], we convert to Message[]
    async getMessages(sessionID) {
      const wrappers = await request<MessageWrapper[]>(`/session/${sessionID}/message`)
      return wrappers.map(wrapperToMessage)
    },
    async sendMessage(sessionID, input: SendMessageInput) {
      const body = toSendMessageBody(input)
      const start = performance.now()
      console.log(`[API] POST /session/${sessionID}/message →`, JSON.stringify(body).slice(0, 200))
      const res = await fetch(`${url}/session/${sessionID}/message`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
      })
      const elapsed = (performance.now() - start).toFixed(0)
      if (!res.ok) {
        const errText = await res.text()
        console.log(`[API] POST /session/${sessionID}/message ← ${res.status} ERR (${elapsed}ms)`)
        throw new Error(`Send message failed ${res.status}: ${errText}`)
      }
      console.log(`[API] POST /session/${sessionID}/message ← ${res.status} OK (${elapsed}ms)`)
      // Response is streamed via SSE, not returned here
    },

    // Question / Permission
    async replyQuestion(requestID, answers) {
      await request(`/question/${requestID}/reply`, {
        method: 'POST',
        body: JSON.stringify({ answers }),
      })
    },
    async rejectQuestion(requestID) {
      await request(`/question/${requestID}/reject`, { method: 'POST' })
    },
    async replyPermission(requestID, allow) {
      await request(`/permission/${requestID}/reply`, {
        method: 'POST',
        body: JSON.stringify({ allow }),
      })
    },

    // Abort
    async abortSession(sessionID) {
      return request<boolean>(`/session/${sessionID}/abort`, { method: 'POST' })
    },

    // Config
    async getConfig() {
      return request<OpenCodeConfig>('/config')
    },

    // SSE - with auth token
    connectSSE(onEvent: (event: OpenCodeEvent) => void) {
      const sseUrl = token ? `${url}/event?token=${encodeURIComponent(token)}` : `${url}/event`
      const eventSource = new EventSource(sseUrl)
      // Track first-delta per session for concise logging
      const deltaStarted = new Set<string>()

      eventSource.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as OpenCodeEvent
          if (event.type) {
            // Log session events
            if (event.type.startsWith('session.')) {
              console.log('[SSE RAW]', event.type, JSON.stringify(event.properties).slice(0, 300))
            }
            // Log first delta & completion for message streaming
            else if (event.type === 'message.part.delta') {
              const p = event.properties as Record<string, unknown>
              const key = `${p.sessionID}:${p.messageID}`
              if (!deltaStarted.has(key)) {
                deltaStarted.add(key)
                console.log('[SSE] Stream started', key, 'first delta:', String(p.delta).slice(0, 80))
              }
            } else if (event.type === 'message.updated') {
              const p = event.properties as Record<string, unknown>
              const info = p.info as Record<string, unknown> | undefined
              const key = `${info?.sessionID}:${info?.id}`
              deltaStarted.delete(key)
              console.log('[SSE] message.updated', info?.id, 'role:', info?.role)
            } else if (event.type === 'message.part.updated') {
              const p = event.properties as Record<string, unknown>
              const part = p.part as Record<string, unknown> | undefined
              console.log('[SSE] message.part.updated', part?.id, 'type:', part?.type)
            }
            onEvent(event)
          }
        } catch {
          // ignore parse errors
        }
      }

      eventSource.onerror = (err) => {
        console.warn('[SSE] Connection error, will auto-reconnect', err)
      }

      return () => eventSource.close()
    },

    // Health - check by listing sessions
    async checkHealth() {
      try {
        const fetchHeaders: HeadersInit = { ...(token ? { 'Authorization': `Bearer ${token}` } : {}) }
        const res = await fetch(`${url}/session`, {
          headers: fetchHeaders,
          signal: AbortSignal.timeout(3000),
        })
        return res.ok
      } catch {
        return false
      }
    },
  }
}
