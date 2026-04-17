import { useSession } from '../../stores/session-store'
import type { ToolPart } from '../../services/opencode-api'

interface TerminalEntry {
  command: string
  output: string
  status: string
}

function extractTerminalEntries(messages: { parts: { type: string }[] }[]): TerminalEntry[] {
  const entries: TerminalEntry[] = []
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === 'tool') {
        const tp = part as unknown as ToolPart
        if (tp.tool === 'bash') {
          const command = (tp.state.input?.command as string) || ''
          const output = tp.state.status === 'completed' && 'output' in tp.state ? (tp.state.output || '') : ''
          const error = tp.state.status === 'error' && 'error' in tp.state ? tp.state.error : ''
          entries.push({ command, output: error || output, status: tp.state.status })
        }
      }
    }
  }
  return entries
}

export default function TerminalPanel() {
  const { state } = useSession()
  const entries = extractTerminalEntries(state.messages)

  return (
    <div className="dt-terminal">
      <div className="dt-terminal-header">
        <span className="dt-terminal-title">Terminal</span>
        <span className="dt-terminal-count">{entries.length} commands</span>
      </div>
      <div className="dt-terminal-body">
        {entries.length === 0 ? (
          <div className="dt-terminal-empty">
            <span className="dt-muted">AI 执行的命令将显示在这里</span>
          </div>
        ) : (
          entries.map((entry, i) => (
            <div key={i} className={`dt-terminal-entry ${entry.status}`}>
              <div className="dt-terminal-cmd">
                <span className="dt-terminal-prompt">$</span>
                <span>{entry.command}</span>
              </div>
              {entry.output && (
                <pre className="dt-terminal-output">{entry.output}</pre>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
