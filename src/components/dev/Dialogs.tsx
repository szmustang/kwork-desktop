import { useState } from 'react'
import { useSession } from '../../stores/session-store'

export function QuestionDialog() {
  const { state, replyQuestion } = useSession()
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const question = state.pendingQuestions[0]

  if (!question) return null

  const handleSubmit = () => {
    const vals = question.questions.map((q) => answers[q.id] || q.defaultValue || '')
    replyQuestion(question.requestID, vals)
    setAnswers({})
  }

  return (
    <div className="dt-dialog-overlay">
      <div className="dt-dialog">
        <div className="dt-dialog-header">
          <span>AI 需要你的输入</span>
        </div>
        <div className="dt-dialog-body">
          {question.questions.map((q) => (
            <div key={q.id} className="dt-dialog-field">
              <label>{q.text}</label>
              {q.type === 'confirm' ? (
                <div className="dt-dialog-confirm">
                  <button onClick={() => { setAnswers({ ...answers, [q.id]: 'yes' }); }}>是</button>
                  <button onClick={() => { setAnswers({ ...answers, [q.id]: 'no' }); }}>否</button>
                </div>
              ) : q.type === 'select' && q.options ? (
                <select
                  value={answers[q.id] || ''}
                  onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                >
                  <option value="">请选择...</option>
                  {q.options.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={answers[q.id] || ''}
                  onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                  placeholder={q.defaultValue || '输入回答...'}
                />
              )}
            </div>
          ))}
        </div>
        <div className="dt-dialog-footer">
          <button className="dt-dialog-btn primary" onClick={handleSubmit}>提交</button>
        </div>
      </div>
    </div>
  )
}

export function PermissionDialog() {
  const { state, replyPermission } = useSession()
  const permission = state.pendingPermissions[0]

  if (!permission) return null

  return (
    <div className="dt-dialog-overlay">
      <div className="dt-dialog">
        <div className="dt-dialog-header">
          <span>权限请求</span>
        </div>
        <div className="dt-dialog-body">
          <p>{typeof permission.description === 'string' ? permission.description : JSON.stringify(permission.description)}</p>
          {permission.tool && (
            <div className="dt-dialog-tool-info">
              <span className="dt-muted">工具: {typeof permission.tool === 'string' ? permission.tool : JSON.stringify(permission.tool)}</span>
            </div>
          )}
        </div>
        <div className="dt-dialog-footer">
          <button
            className="dt-dialog-btn secondary"
            onClick={() => replyPermission(permission.requestID, false)}
          >
            拒绝
          </button>
          <button
            className="dt-dialog-btn primary"
            onClick={() => replyPermission(permission.requestID, true)}
          >
            允许
          </button>
        </div>
      </div>
    </div>
  )
}
