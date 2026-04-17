// ===== OpenCode API Types =====
// 匹配真实 OpenCode Server API 格式

// --- Session ---
export interface Session {
  id: string
  slug: string
  projectID: string
  directory: string
  title: string
  version: string
  parentID?: string
  summary: {
    additions: number
    deletions: number
    files: number
  }
  time: {
    created: number
    updated: number
    archived?: number
  }
}

export interface SessionStatus {
  type: 'idle' | 'busy' | 'error' | 'active'
  retry?: number
  message?: string
}

// --- Message (从 API 返回的包装格式) ---
export interface MessageWrapper {
  info: MessageInfo
  parts: Part[]
}

export interface MessageInfo {
  id: string
  role: 'user' | 'assistant'
  sessionID: string
  time: { created: number }
  agent?: string
  model?: { providerID: string; modelID: string }
  summary?: { diffs: unknown[] }
}

// 内部使用的扁平化消息
export interface Message {
  id: string
  role: 'user' | 'assistant'
  sessionID: string
  createdAt: number
  agent?: string
  model?: { providerID: string; modelID: string }
  parts: Part[]
}

// --- Part (消息部分) ---
export type Part =
  | TextPart
  | ToolPart
  | FilePart
  | ReasoningPart
  | StepStartPart
  | StepFinishPart

export interface TextPart {
  id: string
  type: 'text'
  messageID: string
  sessionID: string
  text: string
  synthetic?: boolean
  metadata?: Record<string, unknown>
}

export interface ToolPart {
  id: string
  type: 'tool'
  messageID: string
  sessionID: string
  tool: string
  state: ToolState
}

export type ToolState =
  | ToolStatePending
  | ToolStateRunning
  | ToolStateCompleted
  | ToolStateError

export interface ToolStatePending {
  status: 'pending'
  input?: Record<string, unknown>
}

export interface ToolStateRunning {
  status: 'running'
  input?: Record<string, unknown>
}

export interface ToolStateCompleted {
  status: 'completed'
  input?: Record<string, unknown>
  output?: string
  metadata?: Record<string, unknown>
}

export interface ToolStateError {
  status: 'error'
  input?: Record<string, unknown>
  error: string
}

export interface FilePart {
  id: string
  type: 'file'
  messageID: string
  sessionID: string
  filename: string
  mediaType: string
  url?: string
}

export interface ReasoningPart {
  id: string
  type: 'reasoning'
  messageID: string
  sessionID: string
  text: string
}

export interface StepStartPart {
  id: string
  type: 'step-start'
  messageID: string
  sessionID: string
  text?: string
}

export interface StepFinishPart {
  id: string
  type: 'step-finish'
  messageID: string
  sessionID: string
  text?: string
}

// --- SSE Events ---
export interface SSEEvent {
  type: string
  properties: Record<string, unknown>
}

export interface MessageUpdatedEvent {
  type: 'message.updated'
  properties: { info: MessageInfo }
}

export interface MessagePartUpdatedEvent {
  type: 'message.part.updated'
  properties: { part: Part; delta?: string }
}

export interface MessagePartDeltaEvent {
  type: 'message.part.delta'
  properties: {
    sessionID: string
    messageID: string
    partID: string
    field: string
    delta: string
  }
}

export interface MessageRemovedEvent {
  type: 'message.removed'
  properties: { sessionID: string; messageID: string }
}

export interface MessagePartRemovedEvent {
  type: 'message.part.removed'
  properties: { sessionID: string; messageID: string; partID: string }
}

export interface SessionStatusEvent {
  type: 'session.status'
  properties: { sessionID: string; status: SessionStatus }
}

export interface SessionCreatedEvent {
  type: 'session.created'
  properties: Session
}

export interface SessionUpdatedEvent {
  type: 'session.updated'
  properties: Session
}

export interface SessionDeletedEvent {
  type: 'session.deleted'
  properties: { id: string }
}

export interface QuestionAskedEvent {
  type: 'question.asked'
  properties: {
    requestID: string
    sessionID: string
    questions: Question[]
  }
}

export interface PermissionAskedEvent {
  type: 'permission.asked'
  properties: {
    requestID: string
    sessionID: string
    description: string
    tool?: string
    input?: Record<string, unknown>
  }
}

export type OpenCodeEvent =
  | MessageUpdatedEvent
  | MessagePartUpdatedEvent
  | MessagePartDeltaEvent
  | MessageRemovedEvent
  | MessagePartRemovedEvent
  | SessionStatusEvent
  | SessionCreatedEvent
  | SessionUpdatedEvent
  | SessionDeletedEvent
  | QuestionAskedEvent
  | PermissionAskedEvent

// --- Question / Permission ---
export interface Question {
  id: string
  type: 'text' | 'confirm' | 'select'
  text: string
  options?: string[]
  defaultValue?: string
}

// --- API Interface ---
/** 发送消息时的输入（内部使用，text 方便调用方传递） */
export interface SendMessageInput {
  text: string
  files?: FilePart[]
  agent?: string
  model?: { providerID: string; modelID: string }
}

/** 实际 API 请求体格式：parts 数组 */
export interface SendMessageBody {
  parts: Array<{ type: 'text'; text: string } | { type: 'file'; filename: string; mediaType: string; url?: string }>
  agent?: string
  model?: { providerID: string; modelID: string }
}

/** 将 SendMessageInput 转为 API 请求体 */
export function toSendMessageBody(input: SendMessageInput): SendMessageBody {
  const parts: SendMessageBody['parts'] = []
  if (input.text) {
    parts.push({ type: 'text', text: input.text })
  }
  if (input.files) {
    for (const f of input.files) {
      parts.push({ type: 'file', filename: f.filename, mediaType: f.mediaType, url: f.url })
    }
  }
  return {
    parts,
    ...(input.agent ? { agent: input.agent } : {}),
    ...(input.model ? { model: input.model } : {}),
  }
}

export interface ServerInfo {
  url: string
  token?: string
}

// --- Config / Model ---
export interface ModelInfo {
  providerID: string
  modelID: string
  name: string
}

export interface ProviderConfig {
  name?: string
  models: Record<string, { name?: string; [k: string]: unknown }>
}

export interface OpenCodeConfig {
  provider: Record<string, ProviderConfig>
  [k: string]: unknown
}

/** 从 config 中提取扁平化模型列表 */
export function extractModels(config: OpenCodeConfig): ModelInfo[] {
  const models: ModelInfo[] = []
  for (const [providerID, provider] of Object.entries(config.provider || {})) {
    for (const [modelID, model] of Object.entries(provider.models || {})) {
      models.push({
        providerID,
        modelID,
        name: model.name || modelID,
      })
    }
  }
  return models
}

export interface OpenCodeAPI {
  // Session
  listSessions(): Promise<Session[]>
  createSession(): Promise<Session>
  getSession(sessionID: string): Promise<Session>
  deleteSession(sessionID: string): Promise<void>

  // Messages
  getMessages(sessionID: string): Promise<Message[]>
  sendMessage(sessionID: string, input: SendMessageInput): Promise<void>

  // Question / Permission
  replyQuestion(requestID: string, answers: string[]): Promise<void>
  rejectQuestion(requestID: string): Promise<void>
  replyPermission(requestID: string, allow: boolean): Promise<void>

  // Abort
  abortSession(sessionID: string): Promise<boolean>

  // Config
  getConfig(): Promise<OpenCodeConfig>

  // SSE
  connectSSE(onEvent: (event: OpenCodeEvent) => void): () => void

  // Health
  checkHealth(): Promise<boolean>
}

/** Convert API MessageWrapper to internal Message */
export function wrapperToMessage(wrapper: MessageWrapper): Message {
  return {
    id: wrapper.info.id,
    role: wrapper.info.role,
    sessionID: wrapper.info.sessionID,
    createdAt: wrapper.info.time.created,
    agent: wrapper.info.agent,
    model: wrapper.info.model,
    parts: wrapper.parts,
  }
}
