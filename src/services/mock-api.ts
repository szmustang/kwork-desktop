import type {
  OpenCodeAPI,
  Session,
  Message,
  Part,
  TextPart,
  ToolPart,
  StepStartPart,
  StepFinishPart,
  ReasoningPart,
  SendMessageInput,
  OpenCodeEvent,
  OpenCodeConfig,
} from './opencode-api'

let idCounter = 100

function uid(prefix: string) {
  return `${prefix}_${++idCounter}`
}

function now() {
  return new Date().toISOString()
}

// --- Mock data generators ---

function mockTextPart(sessionID: string, messageID: string, text: string): TextPart {
  return { id: uid('part'), type: 'text', messageID, sessionID, text }
}

function mockToolPart(
  sessionID: string,
  messageID: string,
  tool: string,
  input: Record<string, unknown>,
  output: string,
): ToolPart {
  return {
    id: uid('part'),
    type: 'tool',
    messageID,
    sessionID,
    tool,
    state: { status: 'completed', input, output },
  }
}

function mockStepStart(sessionID: string, messageID: string, text: string): StepStartPart {
  return { id: uid('part'), type: 'step-start', messageID, sessionID, text }
}

function mockStepFinish(sessionID: string, messageID: string, text: string): StepFinishPart {
  return { id: uid('part'), type: 'step-finish', messageID, sessionID, text }
}

function mockReasoning(sessionID: string, messageID: string, text: string): ReasoningPart {
  return { id: uid('part'), type: 'reasoning', messageID, sessionID, text }
}

// --- Pre-built mock session ---

const MOCK_SESSION_ID = 'ses_mock_001'
const MOCK_APP_ID = 'default'

function buildMockMessages(): Message[] {
  const sid = MOCK_SESSION_ID

  const userMsg1ID = uid('msg')
  const assistMsg1ID = uid('msg')
  const userMsg2ID = uid('msg')
  const assistMsg2ID = uid('msg')

  return [
    {
      id: userMsg1ID,
      role: 'user',
      sessionID: sid,
      createdAt: now(),
      parts: [mockTextPart(sid, userMsg1ID, '帮我创建一个 React 组件，用于显示用户列表')],
    },
    {
      id: assistMsg1ID,
      role: 'assistant',
      sessionID: sid,
      createdAt: now(),
      parts: [
        mockReasoning(sid, assistMsg1ID, '用户需要一个 React 组件来显示用户列表。我需要创建一个 TypeScript 文件，包含类型定义和组件实现。让我先读取项目结构，然后创建文件。'),
        mockStepStart(sid, assistMsg1ID, '分析项目结构'),
        mockToolPart(sid, assistMsg1ID, 'bash', { command: 'ls src/components/' }, 'ChatTab.tsx\nWorkTab.tsx\nDevTab.tsx'),
        mockStepFinish(sid, assistMsg1ID, '项目结构分析完成'),
        mockTextPart(sid, assistMsg1ID, '好的，我来创建一个 `UserList` 组件。首先读取现有组件了解项目风格：'),
        mockToolPart(
          sid, assistMsg1ID, 'file_read',
          { path: 'src/components/ChatTab.tsx' },
          'import { useState } from "react"\n// ... (84 lines)',
        ),
        mockTextPart(sid, assistMsg1ID, '现在创建用户列表组件：'),
        mockToolPart(
          sid, assistMsg1ID, 'file_edit',
          {
            path: 'src/components/UserList.tsx',
            diff: `+import { useState, useEffect } from 'react'
+
+interface User {
+  id: number
+  name: string
+  email: string
+  role: 'admin' | 'user'
+}
+
+export default function UserList() {
+  const [users, setUsers] = useState<User[]>([])
+  const [loading, setLoading] = useState(true)
+
+  useEffect(() => {
+    fetchUsers().then(setUsers).finally(() => setLoading(false))
+  }, [])
+
+  if (loading) return <div className="spinner">Loading...</div>
+
+  return (
+    <div className="user-list">
+      {users.map(user => (
+        <div key={user.id} className="user-card">
+          <span className="user-name">{user.name}</span>
+          <span className="user-email">{user.email}</span>
+          <span className={\`badge \${user.role}\`}>{user.role}</span>
+        </div>
+      ))}
+    </div>
+  )
+}`,
          },
          'File created: src/components/UserList.tsx',
        ),
        mockTextPart(sid, assistMsg1ID, '已创建 `UserList.tsx` 组件，包含：\n- `User` 类型定义\n- 加载状态管理\n- 用户卡片列表渲染\n\n需要我添加样式或进一步修改吗？'),
      ],
    },
    {
      id: userMsg2ID,
      role: 'user',
      sessionID: sid,
      createdAt: now(),
      parts: [mockTextPart(sid, userMsg2ID, '给这个组件加上搜索功能和单元测试')],
    },
    {
      id: assistMsg2ID,
      role: 'assistant',
      sessionID: sid,
      createdAt: now(),
      parts: [
        mockStepStart(sid, assistMsg2ID, '添加搜索功能'),
        mockToolPart(
          sid, assistMsg2ID, 'file_edit',
          {
            path: 'src/components/UserList.tsx',
            diff: `+  const [search, setSearch] = useState('')
+
+  const filtered = users.filter(u =>
+    u.name.toLowerCase().includes(search.toLowerCase()) ||
+    u.email.toLowerCase().includes(search.toLowerCase())
+  )
+
+  // In the JSX:
+  <input
+    className="search-input"
+    placeholder="搜索用户..."
+    value={search}
+    onChange={e => setSearch(e.target.value)}
+  />`,
          },
          'File modified: src/components/UserList.tsx (+12 lines)',
        ),
        mockStepFinish(sid, assistMsg2ID, '搜索功能已添加'),
        mockStepStart(sid, assistMsg2ID, '创建单元测试'),
        mockToolPart(
          sid, assistMsg2ID, 'bash',
          { command: 'mkdir -p src/__tests__' },
          '',
        ),
        mockToolPart(
          sid, assistMsg2ID, 'file_edit',
          {
            path: 'src/__tests__/UserList.test.tsx',
            diff: `+import { render, screen, fireEvent } from '@testing-library/react'
+import UserList from '../components/UserList'
+
+describe('UserList', () => {
+  it('renders user cards', async () => {
+    render(<UserList />)
+    expect(await screen.findByText('Loading...')).toBeInTheDocument()
+  })
+
+  it('filters users by search', async () => {
+    render(<UserList />)
+    const input = screen.getByPlaceholderText('搜索用户...')
+    fireEvent.change(input, { target: { value: 'admin' } })
+    // assertions...
+  })
+})`,
          },
          'File created: src/__tests__/UserList.test.tsx',
        ),
        mockToolPart(
          sid, assistMsg2ID, 'bash',
          { command: 'npx vitest run src/__tests__/UserList.test.tsx' },
          '✓ UserList > renders user cards (45ms)\n✓ UserList > filters users by search (32ms)\n\nTest Files  1 passed (1)\nTests       2 passed (2)',
        ),
        mockStepFinish(sid, assistMsg2ID, '测试全部通过'),
        mockTextPart(sid, assistMsg2ID, '完成！已添加：\n1. 搜索功能 - 支持按姓名和邮箱过滤\n2. 单元测试 - 2 个测试用例全部通过'),
      ],
    },
  ]
}

// --- Mock Session list ---

const mockSessions: Session[] = [
  {
    id: MOCK_SESSION_ID,
    appID: MOCK_APP_ID,
    title: '创建 UserList 组件',
    createdAt: now(),
    updatedAt: now(),
  },
]

// --- Mock API Implementation ---

export function createMockAPI(): OpenCodeAPI {
  let messages = buildMockMessages()
  let eventCallback: ((event: OpenCodeEvent) => void) | null = null

  const emitEvent = (event: OpenCodeEvent) => {
    if (eventCallback) {
      setTimeout(() => eventCallback?.(event), 50)
    }
  }

  // Simulate streaming AI response
  const simulateResponse = (sessionID: string, userText: string) => {
    const assistMsgID = uid('msg')
    const assistMsg: Message = {
      id: assistMsgID,
      role: 'assistant',
      sessionID,
      createdAt: now(),
      parts: [],
    }

    // Emit message created
    emitEvent({ type: 'message.updated', properties: { info: assistMsg } })
    emitEvent({ type: 'session.status', properties: { sessionID, status: 'active' } })

    // Simulate thinking
    const reasoningPart = mockReasoning(sessionID, assistMsgID, `用户说："${userText}"。让我分析需求并给出回答...`)
    setTimeout(() => {
      emitEvent({ type: 'message.part.updated', properties: { part: reasoningPart } })
    }, 300)

    // Simulate step + tool call
    const step1 = mockStepStart(sessionID, assistMsgID, '分析需求')
    setTimeout(() => {
      emitEvent({ type: 'message.part.updated', properties: { part: step1 } })
    }, 800)

    const toolPart = mockToolPart(sessionID, assistMsgID, 'bash', { command: `echo "Processing: ${userText.slice(0, 30)}"` }, `Processing: ${userText.slice(0, 30)}`)
    setTimeout(() => {
      emitEvent({ type: 'message.part.updated', properties: { part: toolPart } })
    }, 1500)

    const step1End = mockStepFinish(sessionID, assistMsgID, '需求分析完成')
    setTimeout(() => {
      emitEvent({ type: 'message.part.updated', properties: { part: step1End } })
    }, 2000)

    // Simulate text response with streaming
    const fullText = `收到你的消息："${userText}"。\n\n这是一个模拟的 AI 回复。在实际连接 OpenCode sidecar 后，这里会显示真实的代码生成、文件编辑和命令执行结果。\n\n当前处于 Mock 模式，所有 UI 交互均可正常工作。`
    const textPart = mockTextPart(sessionID, assistMsgID, '')

    let charIndex = 0
    const streamInterval = setInterval(() => {
      const chunk = fullText.slice(charIndex, charIndex + 3)
      charIndex += 3
      textPart.text = fullText.slice(0, charIndex)
      emitEvent({
        type: 'message.part.updated',
        properties: { part: { ...textPart }, delta: chunk },
      })
      if (charIndex >= fullText.length) {
        clearInterval(streamInterval)
        // Update final message
        assistMsg.parts = [reasoningPart, step1, toolPart, step1End, textPart]
        messages = [...messages, assistMsg]
        emitEvent({ type: 'session.status', properties: { sessionID, status: 'idle' } })
      }
    }, 50)
  }

  return {
    async listSessions() {
      return [...mockSessions]
    },
    async createSession(appID) {
      const session: Session = {
        id: uid('ses'),
        appID: appID || MOCK_APP_ID,
        title: '新会话',
        createdAt: now(),
        updatedAt: now(),
      }
      mockSessions.push(session)
      emitEvent({ type: 'session.created', properties: session })
      return session
    },
    async getSession(sessionID) {
      const s = mockSessions.find((s) => s.id === sessionID)
      if (!s) throw new Error('Session not found')
      return s
    },
    async deleteSession(sessionID) {
      const idx = mockSessions.findIndex((s) => s.id === sessionID)
      if (idx >= 0) mockSessions.splice(idx, 1)
      emitEvent({ type: 'session.deleted', properties: { id: sessionID } })
    },

    async getMessages(sessionID) {
      return messages.filter((m) => m.sessionID === sessionID)
    },
    async sendMessage(sessionID, input: SendMessageInput) {
      const userMsgID = uid('msg')
      const userMsg: Message = {
        id: userMsgID,
        role: 'user',
        sessionID,
        createdAt: now(),
        parts: [mockTextPart(sessionID, userMsgID, input.text)],
      }
      messages = [...messages, userMsg]
      emitEvent({ type: 'message.updated', properties: { info: userMsg } })

      // Simulate AI response
      simulateResponse(sessionID, input.text)
    },

    async replyQuestion(_requestID, _answers) {
      // Mock: no-op
    },
    async rejectQuestion(_requestID) {
      // Mock: no-op
    },
    async replyPermission(_requestID, _allow) {
      // Mock: no-op
    },

    async getConfig(): Promise<OpenCodeConfig> {
      return { provider: {} }
    },

    connectSSE(onEvent) {
      eventCallback = onEvent

      // Send initial connected event
      setTimeout(() => {
        onEvent({ type: 'session.status', properties: { sessionID: MOCK_SESSION_ID, status: 'idle' } } as OpenCodeEvent)
      }, 100)

      return () => {
        eventCallback = null
      }
    },

    async checkHealth() {
      return true
    },
  }
}
