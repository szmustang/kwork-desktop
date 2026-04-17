import { useEffect, useRef, useState, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {
  Message, Part, TextPart, ToolPart, ReasoningPart,
  StepStartPart, StepFinishPart,
} from '../../services/opencode-api'
import { useSession } from '../../stores/session-store'

// ===== Part Renderers (参照 OpenCode Desktop message-part.tsx) =====

/** 文本部分：使用 react-markdown 渲染 */
function TextPartView({ part }: { part: TextPart }) {
  return (
    <div className="dt-text-part">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 代码块：带语言标签
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '')
            const isInline = !match && !className
            if (isInline) {
              return <code className="dt-inline-code" {...props}>{children}</code>
            }
            return (
              <div className="dt-code-block">
                {match && <div className="dt-code-lang">{match[1]}</div>}
                <pre><code className={className} {...props}>{children}</code></pre>
              </div>
            )
          },
          // 去除外层 <pre> 包裹，由 dt-code-block 代替
          pre({ children }) {
            return <>{children}</>
          },
        }}
      >
        {part.text}
      </ReactMarkdown>
    </div>
  )
}

/** 工具卡片（参照 OpenCode BasicTool）：可折叠，图标+标题+副标题 */
function ToolPartView({ part }: { part: ToolPart }) {
  const { tool, state } = part
  const isPending = state.status === 'pending' || state.status === 'running'
  const isError = state.status === 'error'
  const isCompleted = state.status === 'completed'
  const [open, setOpen] = useState(false)

  const toolInfo = getToolInfo(tool, state.input)
  const output = isCompleted ? (state as any).output : undefined
  const error = isError ? (state as any).error : undefined
  const hasContent = !!(output || error)

  return (
    <div className={`dt-tool-card ${state.status}`} data-has-content={hasContent}>
      <div
        className="dt-tool-trigger"
        onClick={() => hasContent && !isPending && setOpen(!open)}
        data-clickable={hasContent && !isPending ? 'true' : undefined}
      >
        <span className="dt-tool-icon">{toolInfo.icon}</span>
        <span className="dt-tool-title">{toolInfo.title}</span>
        {!isPending && toolInfo.subtitle && (
          <span className="dt-tool-subtitle">{toolInfo.subtitle}</span>
        )}
        {isPending && <span className="dt-tool-spinner" />}
        {hasContent && !isPending && (
          <span className={`dt-tool-chevron ${open ? 'open' : ''}`}>▾</span>
        )}
      </div>
      {open && output && (
        <div className="dt-tool-content">
          <pre className="dt-tool-output-pre">{output}</pre>
        </div>
      )}
      {open && error && (
        <div className="dt-tool-content dt-tool-error-content">
          <pre className="dt-tool-output-pre">{error}</pre>
        </div>
      )}
      {/* 非展开时显示简要输出 */}
      {!open && isCompleted && output && (
        <div className="dt-tool-summary">
          {output.split('\n')[0].slice(0, 120)}
        </div>
      )}
      {!open && isError && error && (
        <div className="dt-tool-summary dt-tool-error-summary">
          {error.split('\n')[0].slice(0, 120)}
        </div>
      )}
    </div>
  )
}

/** 获取工具展示信息（参照 OpenCode getToolInfo） */
function getToolInfo(tool: string, input: Record<string, unknown> = {}): { icon: string; title: string; subtitle?: string } {
  const filename = (p: unknown) => typeof p === 'string' ? p.split('/').pop() : undefined
  switch (tool) {
    case 'read': return { icon: '👓', title: 'read', subtitle: filename(input.filePath) }
    case 'write': return { icon: '📝', title: 'write', subtitle: filename(input.filePath) }
    case 'edit': return { icon: '🔧', title: 'edit', subtitle: filename(input.filePath) }
    case 'multi_edit': return { icon: '🔧', title: 'multi_edit', subtitle: filename(input.filePath) }
    case 'list': return { icon: '📋', title: 'list', subtitle: filename(input.path) }
    case 'glob': return { icon: '🔍', title: 'glob', subtitle: input.pattern as string }
    case 'grep': return { icon: '🔎', title: 'grep', subtitle: input.pattern as string }
    case 'bash': return { icon: '⌨️', title: 'bash', subtitle: (input.command as string)?.slice(0, 60) }
    case 'task': return { icon: '📋', title: 'task', subtitle: input.description as string }
    case 'webfetch': return { icon: '🌐', title: 'webfetch', subtitle: input.url as string }
    case 'websearch': return { icon: '🌐', title: 'websearch', subtitle: input.query as string }
    case 'todoread': return { icon: '📝', title: 'todoread' }
    case 'todowrite': return { icon: '📝', title: 'todowrite' }
    default: return { icon: '🔧', title: tool, subtitle: getFirstStringInput(input) }
  }
}

function getFirstStringInput(input: Record<string, unknown>): string | undefined {
  const keys = ['description', 'query', 'url', 'filePath', 'path', 'pattern', 'name']
  for (const key of keys) {
    const v = input[key]
    if (typeof v === 'string' && v.length > 0) return v
  }
  return undefined
}

/** 推理/思考过程（参照 OpenCode reasoning-part） */
function ReasoningPartView({ part }: { part: ReasoningPart }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`dt-reasoning-part ${open ? 'open' : ''}`}>
      <div className="dt-reasoning-trigger" onClick={() => setOpen(!open)}>
        <span className="dt-reasoning-icon">💭</span>
        <span>思考过程</span>
        <span className={`dt-reasoning-chevron ${open ? 'open' : ''}`}>▾</span>
      </div>
      {open && <div className="dt-reasoning-content">{part.text}</div>}
    </div>
  )
}

/** 步骤指示器（参照 OpenCode 截图：▶ 开始步骤 / ✓ 步骤完成） */
function StepPartView({ part }: { part: StepStartPart | StepFinishPart }) {
  const isStart = part.type === 'step-start'
  return (
    <div className={`dt-step-part ${isStart ? 'start' : 'finish'}`}>
      <span className="dt-step-icon">{isStart ? '▶' : '✓'}</span>
      <span className="dt-step-text">{isStart ? '开始步骤' : '步骤完成'}</span>
    </div>
  )
}

/** Part 分发渲染 */
function PartRenderer({ part }: { part: Part }) {
  // 隐藏特定工具
  if (part.type === 'tool' && part.tool === 'todowrite') return null
  switch (part.type) {
    case 'text': return part.text?.trim() ? <TextPartView part={part} /> : null
    case 'tool': return <ToolPartView part={part} />
    case 'reasoning': return part.text?.trim() ? <ReasoningPartView part={part} /> : null
    case 'step-start':
    case 'step-finish': return null
    default: return null
  }
}

// ===== Turn-based Message View (参照 OpenCode SessionTurn) =====

/** 用户消息（右对齐气泡） */
function UserMessageView({ message }: { message: Message }) {
  return (
    <div className="dt-user-message">
      <div className="dt-user-message-body">
        <div className="dt-user-message-text">
          {message.parts.map((part) =>
            part.type === 'text' && part.text?.trim() ? (
              <span key={part.id}>{part.text}</span>
            ) : null
          )}
        </div>
      </div>
    </div>
  )
}

/** Assistant 消息（左对齐，含头像+角色+时间+Parts） */
function AssistantMessageView({ message, isBusy, showHeader = true }: { message: Message; isBusy?: boolean; showHeader?: boolean }) {
  const time = new Date(message.createdAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  // 判断是否有可见内容
  const hasVisibleParts = message.parts.some((p) => {
    if (p.type === 'text') return !!p.text?.trim()
    if (p.type === 'tool' && p.tool === 'todowrite') return false
    return true
  })
  return (
    <div className="dt-assistant-message">
      {showHeader && (
        <div className="dt-assistant-header">
          <span className="dt-assistant-avatar">🤖</span>
          <span className="dt-assistant-role">小K</span>
          <span className="dt-assistant-time">{time}</span>
        </div>
      )}
      {hasVisibleParts ? (
        <div className="dt-assistant-parts">
          {message.parts.map((part) => (
            <PartRenderer key={part.id} part={part} />
          ))}
        </div>
      ) : isBusy ? (
        <div className="dt-thinking-body">
          <span className="dt-thinking-dot" />
          <span className="dt-thinking-dot" />
          <span className="dt-thinking-dot" />
        </div>
      ) : null}
    </div>
  )
}

/** 消息分隔线 */
function MessageDivider() {
  return <div className="dt-message-divider" />
}

// ===== MessageTimeline 主组件 =====

export default function MessageTimeline() {
  const { state } = useSession()
  const { messages, status } = state
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const userScrolledRef = useRef(false)

  // 用户主动交互（鼠标滚轮/触屏）时标记为“手动滚动”
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const markUserScrolled = () => {
      userScrolledRef.current = true
    }

    // 检测是否滚回底部，如果是则恢复自动滚动
    const handleScrollEnd = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      const atBottom = scrollHeight - scrollTop - clientHeight < 80
      if (atBottom) {
        userScrolledRef.current = false
      }
    }

    // wheel 和 touchstart 只有用户真实操作才触发，不会被程序化 scrollIntoView 触发
    container.addEventListener('wheel', markUserScrolled, { passive: true })
    container.addEventListener('touchstart', markUserScrolled, { passive: true })
    container.addEventListener('scrollend', handleScrollEnd, { passive: true })
    // 兼容不支持 scrollend 的浏览器，用 scroll 事件判断是否回到底部
    container.addEventListener('scroll', handleScrollEnd, { passive: true })

    return () => {
      container.removeEventListener('wheel', markUserScrolled)
      container.removeEventListener('touchstart', markUserScrolled)
      container.removeEventListener('scrollend', handleScrollEnd)
      container.removeEventListener('scroll', handleScrollEnd)
    }
  }, [])

  // 自动滚动：仅在用户没有手动滚动时触发
  useEffect(() => {
    if (!userScrolledRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className="dt-timeline-empty">
        <div className="dt-empty-icon">⚡</div>
        <h3>开始编程对话</h3>
        <p>描述你的需求，AI 将帮你生成代码、编辑文件、执行命令</p>
      </div>
    )
  }

  // 按轮次分组：user + 后续 assistant
  const turns: { user: Message; assistants: Message[] }[] = []
  let currentTurn: { user: Message; assistants: Message[] } | null = null

  for (const msg of messages) {
    if (msg.role === 'user') {
      if (currentTurn) turns.push(currentTurn)
      currentTurn = { user: msg, assistants: [] }
    } else if (msg.role === 'assistant') {
      if (currentTurn) {
        currentTurn.assistants.push(msg)
      } else {
        // orphan assistant
        turns.push({ user: msg, assistants: [] })
      }
    }
  }
  if (currentTurn) turns.push(currentTurn)

  const isBusy = status?.type === 'busy' || status?.type === 'active'

  return (
    <div className="dt-timeline" ref={containerRef}>
      <div className="dt-timeline-messages">
        {turns.map((turn, idx) => {
          const isLastTurn = idx === turns.length - 1
          return (
            <div key={turn.user.id} className="dt-turn">
              {idx > 0 && <MessageDivider />}
              {turn.user.role === 'user' ? (
                <UserMessageView message={turn.user} />
              ) : (
                <AssistantMessageView message={turn.user} isBusy={isLastTurn && isBusy} />
              )}
              {turn.assistants.map((am, ai) => (
                <AssistantMessageView
                  key={am.id}
                  message={am}
                  showHeader={ai === 0}
                  isBusy={isLastTurn && ai === turn.assistants.length - 1 && isBusy}
                />
              ))}
              {/* 在最后一轮末尾：busy 时显示思考动画 */}
              {isLastTurn && isBusy && (() => {
                const lastAssistant = turn.assistants[turn.assistants.length - 1]
                const lastHasContent = lastAssistant?.parts.some((p: any) => {
                  if (p.type === 'text') return !!p.text?.trim()
                  if (p.type === 'tool' && p.tool === 'todowrite') return false
                  return true
                })
                // 如果没有 assistant 消息，显示带头像的思考块
                if (turn.assistants.length === 0 && turn.user.role === 'user') {
                  return (
                    <div className="dt-thinking">
                      <div className="dt-assistant-header">
                        <span className="dt-assistant-avatar">🤖</span>
                        <span className="dt-assistant-role">小K</span>
                      </div>
                      <div className="dt-thinking-body">
                        <span className="dt-thinking-dot" />
                        <span className="dt-thinking-dot" />
                        <span className="dt-thinking-dot" />
                      </div>
                    </div>
                  )
                }
                // 如果最后一条 assistant 已有内容，在下方追加思考动画（无头像）
                if (lastHasContent) {
                  return (
                    <div className="dt-thinking-body" style={{ marginLeft: 0, marginTop: 8 }}>
                      <span className="dt-thinking-dot" />
                      <span className="dt-thinking-dot" />
                      <span className="dt-thinking-dot" />
                    </div>
                  )
                }
                return null
              })()}
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
