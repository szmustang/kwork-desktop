import { useState, useRef, useCallback, useEffect } from 'react'
import { useSession } from '../../stores/session-store'
import type { ModelInfo } from '../../services/opencode-api'

export default function PromptInput() {
  const { state, sendMessage, setSelectedModel, abortSession } = useSession()
  const [input, setInput] = useState('')
  const [agent, setAgent] = useState<'plan' | 'build'>('plan')
  const [showModels, setShowModels] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const isActive = state.status?.type === 'busy' || state.status?.type === 'active'
  const currentModel = state.selectedModel

  // 点击外部关闭下拉菜单
  useEffect(() => {
    if (!showModels) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowModels(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showModels])

  const handleSend = useCallback(async () => {
    if (!input.trim() || isActive) return
    const text = input
    setInput('')
    const opts: Record<string, unknown> = { agent }
    if (currentModel) {
      opts.model = { providerID: currentModel.providerID, modelID: currentModel.modelID }
    }
    await sendMessage(text, opts)
    textareaRef.current?.focus()
  }, [input, isActive, sendMessage, currentModel])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSelectModel = (model: ModelInfo) => {
    setSelectedModel(model)
    setShowModels(false)
  }

  // 显示名称：截取模型名
  const displayName = currentModel ? currentModel.name : '选择模型'

  return (
    <div className="dt-prompt-area">
      <div className="dt-prompt-wrapper">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isActive ? 'AI 正在处理中...' : `描述任务，/ 调用技能与工具，使用 ${displayName} 模型`}
          rows={2}
          disabled={isActive}
          className="dt-prompt-input"
        />
        <div className="dt-prompt-toolbar">
          <div className="dt-prompt-left">
            <button className="dt-prompt-attach" title="选择工作目录">
              📂 选择工作目录
            </button>

            <button className="dt-prompt-attach" title="附加文件">
              📎
            </button>
            {/* Agent switcher */}
            <div className="dt-agent-switcher">
              <button
                className={`dt-agent-btn ${agent === 'plan' ? 'active' : ''}`}
                onClick={() => setAgent('plan')}
                title="Plan 代理：分析和规划任务"
              >
                Plan
              </button>
              <button
                className={`dt-agent-btn ${agent === 'build' ? 'active' : ''}`}
                onClick={() => setAgent('build')}
                title="Build 代理：执行和构建任务"
              >
                Build
              </button>
            </div>
            {/* Model selector */}
            <div className="dt-model-selector" ref={menuRef}>
              <button
                className="dt-prompt-attach dt-model-btn"
                onClick={() => setShowModels(!showModels)}
                title="切换模型"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                </svg>
                <span className="dt-model-name">{displayName}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {showModels && state.models.length > 0 && (
                <div className="dt-model-dropdown">
                  {state.models.map((m) => (
                    <div
                      key={`${m.providerID}:${m.modelID}`}
                      className={`dt-model-option ${currentModel?.providerID === m.providerID && currentModel?.modelID === m.modelID ? 'active' : ''}`}
                      onClick={() => handleSelectModel(m)}
                    >
                      <span className="dt-model-option-name">{m.name}</span>
                      <span className="dt-model-option-provider">{m.providerID}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="dt-prompt-right">
            {isActive ? (
              <button className="dt-prompt-stop" onClick={abortSession} title="中止">
                ■ Stop
              </button>
            ) : (
              <button
                className="dt-prompt-send"
                onClick={handleSend}
                disabled={!input.trim()}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
