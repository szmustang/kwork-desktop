import { useState, useRef, useEffect } from 'react'
import '../styles/work-tab.css'

/* ── 数据类型 ── */
interface NavItem {
  id: string
  label: string
  icon: string
}

interface SessionItem {
  id: string
  title: string
  active?: boolean
}

interface TaskPhase {
  id: string
  label: string
  status: 'completed' | 'pending'
}

interface ThinkingBlock {
  id: number
  type: 'thinking' | 'message' | 'action'
  content?: string
  actionLabel?: string
  actionStatus?: string
}

interface Attachment {
  id: string
  name: string
  color: string
}

/* ── Mock 数据 ── */
const navItems: NavItem[] = [
  { id: 'new-task', label: '新任务', icon: '➕' },
  { id: 'scheduled', label: '定时任务', icon: '⏰' },
  { id: 'ai-partner', label: 'AI搭档', icon: '🤖' },
  { id: 'org', label: '组织', icon: '👥' },
  { id: 'skills', label: '技能', icon: '⚡' },
  { id: 'projects', label: '项目', icon: '📁' },
  { id: 'calendar', label: '日历', icon: '📅' },
  { id: 'meeting', label: '会议', icon: '🎥' },
  { id: 'knowledge', label: '知识库', icon: '📚' },
]

const sessionList: SessionItem[] = [
  { id: 's1', title: '搜索中性笔' },
  { id: 's2', title: '花海药业2025年3期...', active: true },
  { id: 's3', title: '花海药业2025年3期...' },
  { id: 's4', title: '人工智能定义介绍' },
  { id: 's5', title: '今日天气查询' },
  { id: 's6', title: '请求协助完成任务' },
  { id: 's7', title: '自我介绍请求' },
  { id: 's8', title: '自我介绍请求' },
  { id: 's9', title: 'New session - 2026-...' },
]

const taskPhases: TaskPhase[] = [
  { id: 'p0', label: 'Phase 0-前置：加载financial-data-mcp Skill获取工具信息', status: 'completed' },
  { id: 'p0a', label: 'Phase 0-A：获取DataCloud数据（利润表、科目余额、维度数据）', status: 'pending' },
  { id: 'p0b', label: 'Phase 0-B：读取Excel辅助表格（预算、人员结构）', status: 'pending' },
  { id: 'p1', label: 'Phase 1：执行八大章节分析（并行处理）', status: 'pending' },
  { id: 'p2', label: 'Phase 2：生成HTML报告', status: 'pending' },
]

const attachedFiles: Attachment[] = [
  { id: 'a1', name: '辅助分析表-花海人...', color: '#10b981' },
  { id: 'a2', name: '花海药业2025年利...', color: '#10b981' },
  { id: 'a3', name: '花海药业2025年销...', color: '#10b981' },
]

const thinkingBlocks: ThinkingBlock[] = [
  { id: 1, type: 'thinking', content: '我来先检查会话中的数据源，然后为您分析花海药业2025年3期管理费用情况。' },
  { id: 2, type: 'action', actionLabel: 'Visible session inbox', actionStatus: 'completed' },
  { id: 3, type: 'thinking', content: '' },
  { id: 4, type: 'action', actionLabel: 'Session artifacts', actionStatus: 'completed' },
  { id: 5, type: 'thinking', content: '我看到这是一个财务费用分析任务。让我进入财务分析师助理模式来为您处理这个分析需求。' },
  { id: 6, type: 'action', actionLabel: 'Switching to assistant mode', actionStatus: 'completed' },
  { id: 7, type: 'thinking', content: '我来为您分析花海药业2025年3期管理费用情况。首先加载管理费用分析技能并获取相关数据。' },
  { id: 8, type: 'action', actionLabel: 'Loaded skill: admin-expense-analysis', actionStatus: 'completed' },
]

/* ── 组件 ── */
export default function WorkTab() {
  const [activeNav, setActiveNav] = useState('new-task')
  const [activeSession, setActiveSession] = useState('s2')
  const [input, setInput] = useState('')
  const [expandedThinking, setExpandedThinking] = useState<Set<number>>(new Set())
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const toggleThinking = (id: number) => {
    setExpandedThinking(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSend = () => {
    if (!input.trim()) return
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="work-layout">
      {/* ── 左侧导航栏 ── */}
      <aside className="work-sidebar">
        <nav className="work-nav">
          {navItems.map(item => (
            <button
              key={item.id}
              className={`work-nav-item ${activeNav === item.id ? 'active' : ''}`}
              onClick={() => setActiveNav(item.id)}
            >
              <span className="work-nav-icon">{item.icon}</span>
              <span className="work-nav-label">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="work-history">
          <div className="work-history-title">历史对话</div>
          <div className="work-history-list">
            {sessionList.map(session => (
              <button
                key={session.id}
                className={`work-session-item ${activeSession === session.id ? 'active' : ''}`}
                onClick={() => setActiveSession(session.id)}
              >
                {session.title}
              </button>
            ))}
          </div>
        </div>

        <button className="work-settings-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
          <span>配置管理</span>
        </button>
      </aside>

      {/* ── 中间对话区 ── */}
      <div className="work-main">
        <div className="work-main-header">
          <h2 className="work-main-title">花海药业2025年3期管理费用分析</h2>
        </div>

        <div className="work-conversation">
          {/* 附件标签 */}
          <div className="work-attachments-bar">
            {attachedFiles.map(file => (
              <span key={file.id} className="work-file-tag" style={{ borderColor: file.color }}>
                <span className="work-file-dot" style={{ backgroundColor: file.color }} />
                {file.name}
              </span>
            ))}
          </div>

          {/* 用户消息 */}
          <div className="work-user-msg">
            <p>分析花海药业2025年3期管理费用情况。</p>
          </div>

          {/* 思考与动作流 */}
          {thinkingBlocks.map((block, idx) => {
            if (block.type === 'thinking' || block.type === 'message') {
              return (
                <div key={block.id} className="work-thinking-block">
                  <div
                    className="work-thinking-header"
                    onClick={() => toggleThinking(block.id)}
                  >
                    <span className="work-thinking-check">✅</span>
                    <span className="work-thinking-label">思考完成</span>
                    <span className={`work-thinking-arrow ${expandedThinking.has(block.id) ? 'expanded' : ''}`}>
                      ›
                    </span>
                  </div>
                  {block.content && (
                    <p className="work-thinking-content">{block.content}</p>
                  )}
                  {/* 如果下一个是 action，渲染在这个块内 */}
                  {idx + 1 < thinkingBlocks.length && thinkingBlocks[idx + 1].type === 'action' && (
                    <div className="work-action-item">
                      <span className="work-action-check">✅</span>
                      <span className="work-action-label">{thinkingBlocks[idx + 1].actionLabel}</span>
                      <span className="work-action-chevron">›</span>
                      <span className="work-action-status">{thinkingBlocks[idx + 1].actionStatus}</span>
                    </div>
                  )}
                </div>
              )
            }
            // action 单独渲染的情况（前面没有 thinking）已在上面处理
            if (block.type === 'action' && idx > 0 && (thinkingBlocks[idx - 1].type === 'thinking' || thinkingBlocks[idx - 1].type === 'message')) {
              return null // 已在上面 thinking 块中渲染
            }
            return null
          })}

          <div ref={messagesEndRef} />
        </div>

        {/* 输入区 */}
        <div className="work-input-area">
          <div className="work-input-container">
            <textarea
              className="work-input"
              placeholder="Hi, 14756789876，能帮你些什么？"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
            />
            <div className="work-input-actions">
              <button className="work-input-btn" title="附件">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                </svg>
              </button>
              <button className="work-input-btn" title="@提及">
                <span style={{ fontSize: 16, fontWeight: 600 }}>@</span>
              </button>
              <div style={{ flex: 1 }} />
              <button
                className={`work-send-btn ${input.trim() ? 'active' : ''}`}
                onClick={handleSend}
                disabled={!input.trim()}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              </button>
            </div>
          </div>
          <div className="work-input-disclaimer">内容由 AI 生成，请注意甄别</div>
        </div>
      </div>

      {/* ── 右侧面板 ── */}
      <aside className="work-right-panel">
        {/* 任务列表 */}
        <section className="work-panel-section">
          <div className="work-panel-header">
            <h3>任务列表</h3>
            <span className="work-panel-counter">1/5</span>
            <button className="work-panel-edit-btn" title="编辑">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          </div>
          <div className="work-task-phases">
            {taskPhases.map(phase => (
              <div key={phase.id} className={`work-phase-item ${phase.status}`}>
                <span className={`work-phase-check ${phase.status}`}>
                  {phase.status === 'completed' ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" fill="#10b981" />
                      <path d="M8 12l3 3 5-6" stroke="#fff" strokeWidth="2" fill="none" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                    </svg>
                  )}
                </span>
                <span className="work-phase-label">{phase.label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* 成果 */}
        <section className="work-panel-section">
          <div className="work-panel-header">
            <h3>成果</h3>
            <button className="work-panel-edit-btn" title="编辑">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          </div>
          <p className="work-panel-empty">暂无成果</p>
        </section>

        {/* 附件 */}
        <section className="work-panel-section">
          <div className="work-panel-header">
            <h3>附件</h3>
            <button className="work-panel-edit-btn" title="编辑">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          </div>
          <p className="work-panel-empty">暂无附件</p>
        </section>
      </aside>
    </div>
  )
}
