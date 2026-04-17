import { useState, useRef, useEffect } from 'react'
import '../styles/chat-tab.css'

/* ── 数据类型 ── */
interface Contact {
  id: string
  name: string
  avatar: string       // 背景色
  initials: string     // 头像文字
  tag?: 'group' | 'external' | 'ai'
  tagLabel?: string
  preview: string
  online?: boolean
  isGroup?: boolean
}

interface ChatMessage {
  id: number
  sender: string
  avatar: string
  initials: string
  content: string
  self?: boolean
  time?: string
}

/* ── Mock 数据 ── */
const contacts: Contact[] = [
  { id: 'cfo', name: 'CFO', avatar: '#6366f1', initials: 'C', preview: '总结了24小时的财务活动并...', online: true },
  { id: 'rd', name: '产品研发中心', avatar: '#3b82f6', initials: '研', tag: 'group', tagLabel: '群聊', preview: '这个月的财务任务已完结向...', isGroup: true },
  { id: 'cashier', name: '出纳', avatar: '#14b8a6', initials: '出', preview: '业务处理一切顺利' },
  { id: 'ar', name: '应收/收入会计', avatar: '#f59e0b', initials: '收', tag: 'external', tagLabel: '外部', preview: '喜报，今天回款一笔200,00...' },
  { id: 'ap', name: '应付/费用会计', avatar: '#8b5cf6', initials: '付', tag: 'ai', tagLabel: 'AI搭档', preview: '业务处理一切顺利' },
  { id: 'asset', name: '资产会计', avatar: '#ec4899', initials: '资', tag: 'ai', tagLabel: 'AI搭档', preview: '业务处理一切顺利' },
  { id: 'tax', name: '税务会计', avatar: '#06b6d4', initials: '税', preview: '业务处理一切顺利' },
  { id: 'salary', name: '薪酬会计', avatar: '#84cc16', initials: '薪', preview: '业务处理一切顺利' },
]

const pinnedContacts = [
  { name: 'CFO', initials: 'C', color: '#6366f1' },
  { name: '产品研发...', initials: '研', color: '#3b82f6' },
  { name: '财务分析师', initials: '财', color: '#f59e0b' },
  { name: '出纳', initials: '出', color: '#14b8a6' },
]

const chatMessages: ChatMessage[] = [
  { id: 1, sender: '产品经理', avatar: '#6366f1', initials: '产', content: '各位早上好，同步一下本周迭代进度。前端和后端的联调情况怎么样了？' },
  { id: 2, sender: '前端负责人', avatar: '#3b82f6', initials: '前', content: '首页改版和数据看板页面已完成，正在和后端联调接口，预计今天下午可以提测。' },
  { id: 3, sender: '后端负责人', avatar: '#14b8a6', initials: '后', content: '接口已全部就绪，文档也更新了。有两个字段格式和前端约定的不一致，已经在修了。' },
  { id: 4, sender: '我', avatar: '#8b5cf6', initials: '我', content: '联调的问题今天能解决吗？不要影响明天的提测计划。', self: true },
  { id: 5, sender: '前端负责人', avatar: '#3b82f6', initials: '前', content: '没问题，字段对齐后就可以了，不影响提测。' },
  { id: 6, sender: '测试主管', avatar: '#f59e0b', initials: '测', content: 'Q2 版本测试覆盖率已达 94%，还有 3 个 P1 缺陷待修复。建议优先处理登录模块的 token 刷新问题。', time: '今天 10:30' },
  { id: 7, sender: 'UI设计师', avatar: '#ec4899', initials: 'U', content: '新版设计稿已上传 Figma，主要调整了导航栏和卡片组件的间距，请前端同学查看。' },
  { id: 8, sender: '项目经理', avatar: '#06b6d4', initials: '项', content: '本月研发预算执行率 87%，剩余预算 ¥230,000。按当前进度可以覆盖到月底。' },
  { id: 9, sender: '我', avatar: '#8b5cf6', initials: '我', content: '剩余预算够覆盖 Q2 收尾吗？', self: true },
]

/* ── 组件 ── */
export default function ChatTab() {
  const [activeConv, setActiveConv] = useState('rd')
  const [sidebarTab, setSidebarTab] = useState<'msg' | 'contacts'>('msg')
  const [messages, setMessages] = useState<ChatMessage[]>(chatMessages)
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = () => {
    if (!input.trim()) return
    const newMsg: ChatMessage = {
      id: Date.now(),
      sender: '我',
      avatar: '#8b5cf6',
      initials: '我',
      content: input,
      self: true,
    }
    setMessages(prev => [...prev, newMsg])
    setInput('')
  }

  return (
    <div className="tab-content">
      <div className="chat-layout">
        {/* ── 左侧边栏 ── */}
        <aside className="chat-sidebar">
          {/* 消息 / 通讯录 切换 */}
          <div className="sidebar-tabs">
            <button className={`sidebar-tab ${sidebarTab === 'msg' ? 'active' : ''}`} onClick={() => setSidebarTab('msg')}>消息</button>
            <button className={`sidebar-tab ${sidebarTab === 'contacts' ? 'active' : ''}`} onClick={() => setSidebarTab('contacts')}>通讯录</button>
          </div>

          {/* 未读消息 */}
          <div className="sidebar-filter">
            <span className="sidebar-filter-label">未读消息</span>
            <svg className="sidebar-filter-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 6h16M7 12h10M10 18h4" />
            </svg>
          </div>

          {/* 快捷操作 */}
          <div className="quick-actions">
            <button className="quick-action-btn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 12l2 2 4-4" />
              </svg>
              <span>流程中心</span>
            </button>
            <button className="quick-action-btn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="4" />
                <path d="M16 8v5a3 3 0 006 0v-1a10 10 0 10-3.92 7.94" />
              </svg>
              <span>@我的</span>
            </button>
            <button className="quick-action-btn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
              </svg>
              <span>稍后处理</span>
            </button>
          </div>

          {/* 置顶消息 */}
          <div className="pinned-section">
            <div className="pinned-label">置顶消息</div>
            <div className="pinned-avatars">
              {pinnedContacts.map(p => (
                <div key={p.name} className="pinned-item">
                  <div className="avatar" style={{ background: p.color }}>{p.initials}</div>
                  <span className="name">{p.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 会话列表 */}
          <div className="conversation-list">
            {contacts.map(c => (
              <div
                key={c.id}
                className={`conversation-item ${activeConv === c.id ? 'active' : ''}`}
                onClick={() => setActiveConv(c.id)}
              >
                <div
                  className={`conversation-avatar ${c.isGroup ? 'group' : ''}`}
                  style={{ background: c.avatar }}
                >
                  {c.initials}
                  {c.online && <span className="online-dot" />}
                </div>
                <div className="conversation-info">
                  <div className="conversation-name-row">
                    <span className="conversation-name">{c.name}</span>
                    {c.tag && (
                      <span className={`conversation-tag ${c.tag === 'group' ? 'group-tag' : c.tag === 'external' ? 'external-tag' : 'ai-tag'}`}>
                        {c.tagLabel}
                      </span>
                    )}
                  </div>
                  <div className="conversation-preview">{c.preview}</div>
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* ── 右侧聊天区 ── */}
        <div className="chat-main">
          {/* 头部 */}
          <div className="chat-header">
            <div className="chat-header-left">
              <div className="chat-header-avatar" style={{ background: '#3b82f6' }}>研</div>
              <div className="chat-header-info">
                <h3>产品研发中心</h3>
                <span>12 位成员</span>
              </div>
            </div>
            <div className="chat-header-actions">
              <button title="搜索">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                </svg>
              </button>
              <button title="更多">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
                </svg>
              </button>
            </div>
          </div>

          {/* 消息列表 */}
          <div className="chat-messages-area">
            <div className="time-separator">今天 09:00</div>
            {messages.map((msg) => (
              <div key={msg.id}>
                {msg.time && <div className="time-separator">{msg.time}</div>}
                <div className={`chat-msg ${msg.self ? 'self' : ''}`}>
                  <div className="chat-msg-avatar" style={{ background: msg.avatar }}>{msg.initials}</div>
                  <div className="chat-msg-body">
                    {!msg.self && <div className="chat-msg-sender">{msg.sender}</div>}
                    <div className="chat-msg-bubble">
                      {msg.content}
                      {msg.self && (
                        <span className="msg-self-icon">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M12 8v4l2 2" />
                          </svg>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* 输入区 */}
          <div className="chat-input-bar">
            <input
              type="text"
              placeholder="输入消息..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
            />
            <button className="attach-btn" title="附件">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <button className="send-msg-btn" disabled={!input.trim()} onClick={handleSend}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
