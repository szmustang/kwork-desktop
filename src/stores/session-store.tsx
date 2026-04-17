import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  type ReactNode,
  type Dispatch,
} from 'react'
import type {
  Session,
  Message,
  MessageInfo,
  Part,
  SessionStatus,
  OpenCodeEvent,
  OpenCodeAPI,
  Question,
  SendMessageInput,
  ModelInfo,
} from '../services/opencode-api'
import { getAPI, extractModels } from '../services'

// --- State ---

export interface PendingQuestion {
  requestID: string
  sessionID: string
  questions: Question[]
}

export interface PendingPermission {
  requestID: string
  sessionID: string
  description: string | Record<string, unknown>
  tool?: string | Record<string, unknown>
}

export interface SessionState {
  api: OpenCodeAPI | null
  connected: boolean
  sessions: Session[]
  activeSessionID: string | null
  messages: Message[]
  /** Streaming parts indexed by partID, updated via SSE delta */
  streamingParts: Record<string, Part>
  status: SessionStatus
  pendingQuestions: PendingQuestion[]
  pendingPermissions: PendingPermission[]
  models: ModelInfo[]
  selectedModel: ModelInfo | null
}

const initialState: SessionState = {
  api: null,
  connected: false,
  sessions: [],
  activeSessionID: null,
  messages: [],
  streamingParts: {},
  status: { type: 'idle' },
  pendingQuestions: [],
  pendingPermissions: [],
  models: [],
  selectedModel: null,
}

// --- Actions ---

type Action =
  | { type: 'SET_API'; api: OpenCodeAPI }
  | { type: 'SET_CONNECTED'; connected: boolean }
  | { type: 'SET_SESSIONS'; sessions: Session[] }
  | { type: 'SET_ACTIVE_SESSION'; sessionID: string | null }
  | { type: 'ADD_SESSION'; session: Session }
  | { type: 'UPDATE_SESSION'; session: Session }
  | { type: 'REMOVE_SESSION'; sessionID: string }
  | { type: 'SET_MESSAGES'; messages: Message[] }
  | { type: 'UPSERT_MESSAGE'; message: Message }
  | { type: 'UPSERT_MESSAGE_INFO'; info: MessageInfo }
  | { type: 'REMOVE_MESSAGE'; sessionID: string; messageID: string }
  | { type: 'UPSERT_PART'; part: Part; delta?: string }
  | { type: 'APPEND_PART_DELTA'; sessionID: string; messageID: string; partID: string; field: string; delta: string }
  | { type: 'REMOVE_PART'; sessionID: string; messageID: string; partID: string }
  | { type: 'SET_STATUS'; sessionID: string; status: SessionStatus }
  | { type: 'ADD_QUESTION'; question: PendingQuestion }
  | { type: 'REMOVE_QUESTION'; requestID: string }
  | { type: 'ADD_PERMISSION'; permission: PendingPermission }
  | { type: 'REMOVE_PERMISSION'; requestID: string }
  | { type: 'SET_MODELS'; models: ModelInfo[] }
  | { type: 'SET_SELECTED_MODEL'; model: ModelInfo | null }

function reducer(state: SessionState, action: Action): SessionState {
  switch (action.type) {
    case 'SET_API':
      return { ...state, api: action.api }

    case 'SET_CONNECTED':
      return { ...state, connected: action.connected }

    case 'SET_SESSIONS':
      return { ...state, sessions: action.sessions }

    case 'SET_ACTIVE_SESSION':
      return { ...state, activeSessionID: action.sessionID, messages: [], streamingParts: {}, status: { type: 'idle' } }

    case 'ADD_SESSION': {
      // 去重：如果已存在相同 ID 的会话，跳过
      const sid = action.session?.id
      if (!sid || state.sessions.some((s) => s.id === sid)) return state
      return { ...state, sessions: [...state.sessions, action.session] }
    }

    case 'UPDATE_SESSION':
      return {
        ...state,
        sessions: state.sessions.map((s) => {
          if (s.id !== action.session.id) return s
          // 如果当前标题不是 "New session" 开头，而新标题是，则保留当前标题（防止 SSE 回退覆盖用户输入临时标题）
          const incoming = action.session
          if (s.title && !s.title.startsWith('New session') && incoming.title?.startsWith('New session')) {
            return { ...incoming, title: s.title }
          }
          return incoming
        }),
      }

    case 'REMOVE_SESSION':
      return {
        ...state,
        sessions: state.sessions.filter((s) => s.id !== action.sessionID),
        activeSessionID: state.activeSessionID === action.sessionID ? null : state.activeSessionID,
      }

    case 'SET_MESSAGES':
      return { ...state, messages: action.messages }

    case 'UPSERT_MESSAGE': {
      const idx = state.messages.findIndex((m) => m.id === action.message.id)
      if (idx >= 0) {
        const updated = [...state.messages]
        updated[idx] = action.message
        return { ...state, messages: updated }
      }
      return { ...state, messages: [...state.messages, action.message] }
    }

    case 'UPSERT_MESSAGE_INFO': {
      const { info } = action
      const idx = state.messages.findIndex((m) => m.id === info.id)
      if (idx >= 0) {
        // Update existing message info, keep parts
        const updated = [...state.messages]
        updated[idx] = { ...updated[idx], role: info.role }
        return { ...state, messages: updated }
      }
      // Create new message from info (no parts yet)
      const newMsg: Message = {
        id: info.id,
        role: info.role,
        sessionID: info.sessionID,
        createdAt: info.time.created,
        agent: info.agent,
        model: info.model,
        parts: [],
      }
      return { ...state, messages: [...state.messages, newMsg] }
    }

    case 'REMOVE_MESSAGE':
      return {
        ...state,
        messages: state.messages.filter((m) => m.id !== action.messageID),
      }

    case 'UPSERT_PART': {
      const { part } = action
      // Update streaming parts map
      const newStreamingParts = { ...state.streamingParts, [part.id]: part }

      // Also update the part in the corresponding message
      const msgIdx = state.messages.findIndex((m) => m.id === part.messageID)
      if (msgIdx >= 0) {
        const msg = { ...state.messages[msgIdx] }
        const partIdx = msg.parts.findIndex((p) => p.id === part.id)
        if (partIdx >= 0) {
          msg.parts = [...msg.parts]
          msg.parts[partIdx] = part
        } else {
          msg.parts = [...msg.parts, part]
        }
        const newMessages = [...state.messages]
        newMessages[msgIdx] = msg
        return { ...state, messages: newMessages, streamingParts: newStreamingParts }
      }

      return { ...state, streamingParts: newStreamingParts }
    }

    case 'APPEND_PART_DELTA': {
      const { sessionID, messageID, partID, field, delta } = action
      // Find the message
      const dMsgIdx = state.messages.findIndex((m) => m.id === messageID)
      if (dMsgIdx < 0) {
        // Message not found yet, accumulate in streamingParts
        const existing = state.streamingParts[partID]
        if (existing && field in existing) {
          const updated = { ...existing, [field]: ((existing as any)[field] || '') + delta }
          return { ...state, streamingParts: { ...state.streamingParts, [partID]: updated as Part } }
        }
        // Create a minimal text part as placeholder
        const placeholder: Part = {
          id: partID,
          type: 'text',
          messageID,
          sessionID,
          text: delta,
        } as Part
        return { ...state, streamingParts: { ...state.streamingParts, [partID]: placeholder } }
      }

      const dMsg = { ...state.messages[dMsgIdx] }
      const dPartIdx = dMsg.parts.findIndex((p) => p.id === partID)
      if (dPartIdx >= 0) {
        // Append delta to existing part field
        dMsg.parts = [...dMsg.parts]
        const oldPart = dMsg.parts[dPartIdx]
        dMsg.parts[dPartIdx] = { ...oldPart, [field]: ((oldPart as any)[field] || '') + delta } as Part
      } else {
        // Part not in message yet, create it
        const newPart: Part = {
          id: partID,
          type: 'text',
          messageID,
          sessionID,
          text: delta,
        } as Part
        dMsg.parts = [...dMsg.parts, newPart]
      }
      const dMessages = [...state.messages]
      dMessages[dMsgIdx] = dMsg
      // Also update streamingParts
      const latestPart = dMsg.parts.find((p) => p.id === partID)
      const dStreamingParts = latestPart
        ? { ...state.streamingParts, [partID]: latestPart }
        : state.streamingParts
      return { ...state, messages: dMessages, streamingParts: dStreamingParts }
    }

    case 'REMOVE_PART': {
      const msgIdx = state.messages.findIndex((m) => m.id === action.messageID)
      if (msgIdx >= 0) {
        const msg = { ...state.messages[msgIdx] }
        msg.parts = msg.parts.filter((p) => p.id !== action.partID)
        const newMessages = [...state.messages]
        newMessages[msgIdx] = msg
        const { [action.partID]: _, ...rest } = state.streamingParts
        return { ...state, messages: newMessages, streamingParts: rest }
      }
      return state
    }

    case 'SET_STATUS':
      if (state.activeSessionID === action.sessionID) {
        return { ...state, status: action.status }
      }
      return state

    case 'ADD_QUESTION':
      return { ...state, pendingQuestions: [...state.pendingQuestions, action.question] }

    case 'REMOVE_QUESTION':
      return {
        ...state,
        pendingQuestions: state.pendingQuestions.filter((q) => q.requestID !== action.requestID),
      }

    case 'ADD_PERMISSION':
      return { ...state, pendingPermissions: [...state.pendingPermissions, action.permission] }

    case 'REMOVE_PERMISSION':
      return {
        ...state,
        pendingPermissions: state.pendingPermissions.filter((p) => p.requestID !== action.requestID),
      }

    case 'SET_MODELS':
      return { ...state, models: action.models }

    case 'SET_SELECTED_MODEL':
      return { ...state, selectedModel: action.model }

    default:
      return state
  }
}

// --- Context ---

interface SessionContextValue {
  state: SessionState
  dispatch: Dispatch<Action>
  sendMessage: (text: string, opts?: Partial<SendMessageInput>) => Promise<void>
  createNewSession: () => Promise<void>
  switchSession: (sessionID: string) => Promise<void>
  deleteSession: (sessionID: string) => Promise<void>
  replyQuestion: (requestID: string, answers: string[]) => Promise<void>
  replyPermission: (requestID: string, allow: boolean) => Promise<void>
  abortSession: () => Promise<void>
  setSelectedModel: (model: ModelInfo | null) => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  // Initialize API and connect SSE
  useEffect(() => {
    let disconnectSSE: (() => void) | null = null
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const init = async (attempt = 1) => {
      if (cancelled) return
      const MAX_RETRIES = 3
      try {
        console.log(`[SessionStore] Initializing (attempt ${attempt})...`)
        const api = await getAPI()
        if (cancelled) return
        console.log('[SessionStore] API connected')
        dispatch({ type: 'SET_API', api })

        // Load sessions
        const sessions = await api.listSessions()
        if (cancelled) return
        console.log('[SessionStore] Loaded sessions:', sessions.length)
        dispatch({ type: 'SET_SESSIONS', sessions })

        // Load available models
        let models: import('../services/opencode-api').ModelInfo[] = []
        try {
          const config = await api.getConfig()
          models = extractModels(config)
          dispatch({ type: 'SET_MODELS', models })
          console.log('[SessionStore] Loaded models:', models.length)
        } catch {
          console.warn('[SessionStore] Failed to load models')
        }

        // Auto-select first session or create new
        if (sessions.length > 0) {
          dispatch({ type: 'SET_ACTIVE_SESSION', sessionID: sessions[0].id })
          const messages = await api.getMessages(sessions[0].id)
          if (cancelled) return
          dispatch({ type: 'SET_MESSAGES', messages })

          // 从最后一条 assistant 消息获取当前使用的模型作为默认选中
          const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant' && m.model)
          if (lastAssistant?.model && models.length > 0) {
            const match = models.find(
              (m) => m.providerID === lastAssistant.model!.providerID && m.modelID === lastAssistant.model!.modelID,
            )
            if (match) {
              dispatch({ type: 'SET_SELECTED_MODEL', model: match })
            } else {
              // 模型不在列表中，也显示出来
              dispatch({
                type: 'SET_SELECTED_MODEL',
                model: {
                  providerID: lastAssistant.model!.providerID,
                  modelID: lastAssistant.model!.modelID,
                  name: lastAssistant.model!.modelID,
                },
              })
            }
          } else if (models.length > 0) {
            dispatch({ type: 'SET_SELECTED_MODEL', model: models[0] })
          }
        } else {
          // 没有会话时不自动创建，保持空状态，等用户发第一条消息时再创建
          console.log('[SessionStore] No sessions found, showing empty state')
          // 选第一个模型作为默认
          if (models.length > 0) {
            dispatch({ type: 'SET_SELECTED_MODEL', model: models[0] })
          }
        }

        // Connect SSE
        disconnectSSE = api.connectSSE((event: OpenCodeEvent) => {
          handleSSEEvent(dispatch, event)
        })
        dispatch({ type: 'SET_CONNECTED', connected: true })
        console.log('[SessionStore] Fully connected')
      } catch (e) {
        console.error(`[SessionStore] Init failed (attempt ${attempt}):`, e)
        if (!cancelled && attempt < MAX_RETRIES) {
          console.log(`[SessionStore] Retrying in 2s...`)
          retryTimer = setTimeout(() => init(attempt + 1), 2000)
        } else {
          dispatch({ type: 'SET_CONNECTED', connected: false })
        }
      }
    }

    init()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      disconnectSSE?.()
    }
  }, [])

  const sendMessage = useCallback(
    async (text: string, opts?: Partial<SendMessageInput>) => {
      if (!state.api) return
      let sessionID = state.activeSessionID

      // 没有活跃会话时，自动创建一个
      if (!sessionID) {
        try {
          const session = await state.api.createSession()
          // 用用户输入作为临时标题，等服务端总结后通过 SSE session.updated 替换
          const tempTitle = text.length > 50 ? text.slice(0, 50) + '...' : text
          dispatch({ type: 'ADD_SESSION', session: { ...session, title: tempTitle } })
          // SSE session.created 可能先于 HTTP 响应到达，用 UPDATE 强制覆盖标题
          dispatch({ type: 'UPDATE_SESSION', session: { ...session, title: tempTitle } })
          dispatch({ type: 'SET_ACTIVE_SESSION', sessionID: session.id })
          sessionID = session.id
        } catch (e) {
          console.error('[Session] Auto-create session failed:', e)
          return
        }
      }

      try {
        await state.api.sendMessage(sessionID, { text, ...opts })
      } catch (e) {
        console.error('[Session] Send message failed:', e)
      }
    },
    [state.api, state.activeSessionID],
  )

  const createNewSession = useCallback(async () => {
    // 不调 API，仅清空活跃会话，显示新任务欢迎页
    // 真正的会话在用户发送第一条消息时才创建
    dispatch({ type: 'SET_ACTIVE_SESSION', sessionID: null })
  }, [])

  const switchSession = useCallback(
    async (sessionID: string) => {
      if (!state.api) return
      dispatch({ type: 'SET_ACTIVE_SESSION', sessionID })
      try {
        const messages = await state.api.getMessages(sessionID)
        dispatch({ type: 'SET_MESSAGES', messages })
      } catch (e) {
        console.error('[SessionStore] Failed to load messages:', e)
      }
    },
    [state.api],
  )

  const deleteSessionFn = useCallback(
    async (sessionID: string) => {
      if (!state.api) return
      try {
        await state.api.deleteSession(sessionID)
        dispatch({ type: 'REMOVE_SESSION', sessionID })
        // 如果删除的是当前活跃会话，自动切换到第一个
        if (state.activeSessionID === sessionID) {
          const remaining = state.sessions.filter((s) => s.id !== sessionID)
          if (remaining.length > 0) {
            dispatch({ type: 'SET_ACTIVE_SESSION', sessionID: remaining[0].id })
            const messages = await state.api.getMessages(remaining[0].id)
            dispatch({ type: 'SET_MESSAGES', messages })
          } else {
            dispatch({ type: 'SET_ACTIVE_SESSION', sessionID: null })
          }
        }
      } catch (e) {
        console.error('[Session] Delete session failed:', e)
      }
    },
    [state.api, state.activeSessionID, state.sessions],
  )

  const replyQuestionFn = useCallback(
    async (requestID: string, answers: string[]) => {
      if (!state.api) return
      await state.api.replyQuestion(requestID, answers)
      dispatch({ type: 'REMOVE_QUESTION', requestID })
    },
    [state.api],
  )

  const replyPermissionFn = useCallback(
    async (requestID: string, allow: boolean) => {
      if (!state.api) return
      await state.api.replyPermission(requestID, allow)
      dispatch({ type: 'REMOVE_PERMISSION', requestID })
    },
    [state.api],
  )

  const abortSessionFn = useCallback(async () => {
    if (!state.api || !state.activeSessionID) return
    try {
      await state.api.abortSession(state.activeSessionID)
      console.log('[Session] Aborted session:', state.activeSessionID)
    } catch (e) {
      console.error('[Session] Abort failed:', e)
    }
  }, [state.api, state.activeSessionID])

  return (
    <SessionContext.Provider
      value={{
        state,
        dispatch,
        sendMessage,
        createNewSession,
        switchSession,
        deleteSession: deleteSessionFn,
        replyQuestion: replyQuestionFn,
        replyPermission: replyPermissionFn,
        abortSession: abortSessionFn,
        setSelectedModel: (model: ModelInfo | null) => dispatch({ type: 'SET_SELECTED_MODEL', model }),
      }}
    >
      {children}
    </SessionContext.Provider>
  )
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within SessionProvider')
  return ctx
}

// --- SSE Event Handler ---

function handleSSEEvent(dispatch: Dispatch<Action>, event: OpenCodeEvent) {
  switch (event.type) {
    case 'message.updated':
      dispatch({ type: 'UPSERT_MESSAGE_INFO', info: event.properties.info })
      break

    case 'message.part.updated':
      dispatch({
        type: 'UPSERT_PART',
        part: event.properties.part,
        delta: event.properties.delta,
      })
      break

    case 'message.part.delta':
      dispatch({
        type: 'APPEND_PART_DELTA',
        sessionID: event.properties.sessionID as string,
        messageID: event.properties.messageID as string,
        partID: event.properties.partID as string,
        field: event.properties.field as string,
        delta: event.properties.delta as string,
      })
      break

    case 'message.removed':
      dispatch({
        type: 'REMOVE_MESSAGE',
        sessionID: event.properties.sessionID,
        messageID: event.properties.messageID,
      })
      break

    case 'message.part.removed':
      dispatch({
        type: 'REMOVE_PART',
        sessionID: event.properties.sessionID,
        messageID: event.properties.messageID,
        partID: event.properties.partID,
      })
      break

    case 'session.status':
      dispatch({
        type: 'SET_STATUS',
        sessionID: event.properties.sessionID,
        status: event.properties.status,
      })
      break

    case 'session.created': {
      const sc = (event.properties as any)?.info || event.properties
      if (sc?.id) dispatch({ type: 'ADD_SESSION', session: sc as Session })
      break
    }

    case 'session.updated': {
      const su = (event.properties as any)?.info || event.properties
      console.log('[SSE] session.updated', su?.id, 'title:', su?.title)
      if (su?.id) dispatch({ type: 'UPDATE_SESSION', session: su as Session })
      break
    }

    case 'session.deleted': {
      const delId = (event.properties as any)?.info?.id || (event.properties as any)?.id || (event.properties as any)?.sessionID
      if (delId) dispatch({ type: 'REMOVE_SESSION', sessionID: delId })
      break
    }

    case 'question.asked':
      dispatch({
        type: 'ADD_QUESTION',
        question: {
          requestID: event.properties.requestID,
          sessionID: event.properties.sessionID,
          questions: event.properties.questions,
        },
      })
      break

    case 'permission.asked':
      dispatch({
        type: 'ADD_PERMISSION',
        permission: {
          requestID: event.properties.requestID,
          sessionID: event.properties.sessionID,
          description: event.properties.description,
          tool: event.properties.tool,
        },
      })
      break
  }
}
