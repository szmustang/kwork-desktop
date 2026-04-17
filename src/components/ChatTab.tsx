import { useState, useRef, useEffect } from 'react'

interface Message {
  id: number
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

export default function ChatTab() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      role: 'user',
      content: '帮我起草一份关于公司全员远程办公政策的通知',
      timestamp: new Date(Date.now() - 8 * 60000),
    },
    {
      id: 2,
      role: 'assistant',
      content: '好的，以下是远程办公政策通知草稿：\n\n---\n\n**关于实施灵活远程办公政策的通知**\n\n各部门同事：\n\n为提升工作效率与员工满意度，经公司管理层研究决定，自 **2026年5月1日** 起实施灵活远程办公政策，具体安排如下：\n\n1. **适用范围**：全体正式员工（试用期员工需部门主管审批）\n2. **远程天数**：每周最多 2 天远程办公\n3. **申请流程**：通过 OA 系统提交远程办公申请，需提前 1 个工作日\n4. **工作要求**：保持即时通讯在线，响应时间不超过 15 分钟\n5. **会议参与**：远程办公日需按时参加线上会议\n\n请各部门负责人知悉并转达。\n\n---\n\n你可以根据实际情况调整具体参数，需要我修改哪些内容吗？',
      timestamp: new Date(Date.now() - 7 * 60000),
    },
    {
      id: 3,
      role: 'user',
      content: '很好，再帮我整理一下下周的部门会议议程',
      timestamp: new Date(Date.now() - 5 * 60000),
    },
    {
      id: 4,
      role: 'assistant',
      content: '没问题，以下是部门周会议程建议：\n\n**产品部周会 · 议程安排**\n时间：2026年4月21日（周一）10:00 - 11:30\n\n| 序号 | 议题 | 负责人 | 时长 |\n|------|------|---------|------|\n| 1 | 上周工作总结与重点项目进度回顾 | 张三 | 15min |\n| 2 | Q2 OKR 进度检查 | 李四 | 20min |\n| 3 | 新客户需求评审——华南区域项目 | 王五 | 20min |\n| 4 | 产品迭代计划讨论（v3.2 版本） | 张三 | 25min |\n| 5 | 开放讨论 & 问题反馈 | 全员 | 10min |\n\n**会前准备：**\n- 各负责人提前准备汇报材料\n- 张三整理 v3.2 版本需求文档\n\n需要调整时间分配或添加议题吗？',
      timestamp: new Date(Date.now() - 4 * 60000),
    },
    {
      id: 5,
      role: 'user',
      content: '最近公司要做年中绩效考核，帮我列一个考核维度的框架',
      timestamp: new Date(Date.now() - 2 * 60000),
    },
    {
      id: 6,
      role: 'assistant',
      content: '以下是年中绩效考核维度框架建议：\n\n**员工年中绩效考核体系**\n\n**1. 业绩目标达成（40%）**\n- KPI / OKR 完成率\n- 重点项目交付质量\n- 客户满意度评分\n\n**2. 专业能力（25%）**\n- 岗位技能熟练度\n- 问题解决与创新能力\n- 行业知识更新\n\n**3. 协作与沟通（20%）**\n- 跨部门协作效率\n- 信息共享与反馈及时性\n- 团队贡献度\n\n**4. 成长与发展（15%）**\n- 学习与培训参与\n- 新技能掌握情况\n- 带教新人表现\n\n建议采用 **自评 + 主管评 + 360°互评** 三结合的方式。需要我进一步细化某个维度的评分标准吗？',
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = () => {
    if (!input.trim()) return
    const userMsg: Message = {
      id: Date.now(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    }
    setMessages((prev) => [...prev, userMsg])
    setInput('')

    // 模拟 AI 回复
    setTimeout(() => {
      const aiMsg: Message = {
        id: Date.now() + 1,
        role: 'assistant',
        content: `收到你的消息："${input}"。这是一个模拟回复，实际应用中会连接 AI 服务生成智能回复。`,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, aiMsg])
    }, 800)
  }

  return (
    <div className="tab-content">
      <div className="chat-messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.role}`}>
            <div className="message-avatar">
              {msg.role === 'assistant' ? '🤖' : '👤'}
            </div>
            <div className="message-body">
              <div className="message-header">
                <span className="message-role">
                  {msg.role === 'assistant' ? '小K' : 'You'}
                </span>
                <span className="message-time">
                  {msg.timestamp.toLocaleTimeString()}
                </span>
              </div>
              <div className="message-content">{msg.content}</div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div className="chat-input-area">
        <div className="input-wrapper">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
            rows={3}
          />
          <button onClick={handleSend} className="send-btn" disabled={!input.trim()}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 2L11 13" />
              <path d="M22 2L15 22L11 13L2 9L22 2Z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
