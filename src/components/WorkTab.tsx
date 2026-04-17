import { useState } from 'react'

interface Task {
  id: number
  title: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  description: string
  progress?: number
}

const initialTasks: Task[] = [
  { id: 1, title: '代码审查 - auth.ts', status: 'completed', description: '已完成对认证模块的代码审查', progress: 100 },
  { id: 2, title: '重构 API 路由', status: 'running', description: '正在优化 REST API 路由结构...', progress: 65 },
  { id: 3, title: '数据库迁移脚本', status: 'running', description: '生成数据库 Schema 迁移文件...', progress: 30 },
  { id: 4, title: '单元测试生成', status: 'pending', description: '为 utils 模块生成单元测试' },
  { id: 5, title: '性能优化分析', status: 'pending', description: '分析应用性能瓶颈' },
  { id: 6, title: '部署配置检查', status: 'failed', description: 'Docker 配置文件存在兼容性问题' },
]

const statusConfig = {
  pending: { label: '等待中', icon: '⏳', color: '#888' },
  running: { label: '运行中', icon: '⚡', color: '#d4a843' },
  completed: { label: '已完成', icon: '✅', color: '#4caf50' },
  failed: { label: '失败', icon: '❌', color: '#ef5350' },
}

export default function WorkTab() {
  const [tasks] = useState<Task[]>(initialTasks)
  const [filter, setFilter] = useState<string>('all')

  const filteredTasks = filter === 'all' ? tasks : tasks.filter((t) => t.status === filter)

  const stats = {
    total: tasks.length,
    completed: tasks.filter((t) => t.status === 'completed').length,
    running: tasks.filter((t) => t.status === 'running').length,
    failed: tasks.filter((t) => t.status === 'failed').length,
  }

  return (
    <div className="tab-content work-tab">
      <div className="work-header">
        <h2>工作任务</h2>
        <div className="work-stats">
          <span className="stat">📊 总计 {stats.total}</span>
          <span className="stat completed">✅ {stats.completed}</span>
          <span className="stat running">⚡ {stats.running}</span>
          <span className="stat failed">❌ {stats.failed}</span>
        </div>
      </div>

      <div className="filter-bar">
        {['all', 'pending', 'running', 'completed', 'failed'].map((f) => (
          <button
            key={f}
            className={`filter-btn ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? '全部' : statusConfig[f as keyof typeof statusConfig].label}
          </button>
        ))}
      </div>

      <div className="task-list">
        {filteredTasks.map((task) => {
          const cfg = statusConfig[task.status]
          return (
            <div key={task.id} className={`task-card ${task.status}`}>
              <div className="task-header">
                <span className="task-icon">{cfg.icon}</span>
                <span className="task-title">{task.title}</span>
                <span className="task-status" style={{ color: cfg.color }}>
                  {cfg.label}
                </span>
              </div>
              <p className="task-desc">{task.description}</p>
              {task.progress !== undefined && (
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${task.progress}%`, backgroundColor: cfg.color }}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
