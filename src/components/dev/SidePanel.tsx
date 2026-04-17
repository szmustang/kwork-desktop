import { useState } from 'react'
import { useSession } from '../../stores/session-store'
import type { ToolPart, Message } from '../../services/opencode-api'

// --- DiffViewer ---

function DiffViewer({ diff }: { diff: string }) {
  const lines = diff.split('\n')
  return (
    <div className="dt-diff-viewer">
      {lines.map((line, i) => {
        let cls = 'dt-diff-context'
        if (line.startsWith('+')) cls = 'dt-diff-add'
        else if (line.startsWith('-')) cls = 'dt-diff-remove'
        else if (line.startsWith('@@')) cls = 'dt-diff-hunk'
        return (
          <div key={i} className={`dt-diff-line ${cls}`}>
            <span className="dt-diff-content">{line}</span>
          </div>
        )
      })}
    </div>
  )
}

// --- FileChanges (from tool parts) ---

interface FileChange {
  path: string
  tool: string
  diff?: string
  output?: string
}

function extractFileChanges(messages: Message[]): FileChange[] {
  const changes: FileChange[] = []
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === 'tool') {
        const tp = part as ToolPart
        if (tp.tool === 'file_edit' && tp.state.status === 'completed') {
          const input = tp.state.input || {}
          changes.push({
            path: (input.path as string) || 'unknown',
            tool: tp.tool,
            diff: (input.diff as string) || undefined,
            output: 'output' in tp.state ? tp.state.output : undefined,
          })
        }
      }
    }
  }
  return changes
}

// --- Review Tab ---

function ReviewTab() {
  const { state } = useSession()
  const changes = extractFileChanges(state.messages)

  if (changes.length === 0) {
    return (
      <div className="dt-review-empty">
        <p>暂无文件变更</p>
        <p className="dt-muted">AI 编辑文件后，变更将显示在这里</p>
      </div>
    )
  }

  return (
    <div className="dt-review-list">
      {changes.map((change, i) => (
        <div key={i} className="dt-review-item">
          <div className="dt-review-file-header">
            <span className="dt-review-file-icon">📝</span>
            <span className="dt-review-file-path">{change.path}</span>
          </div>
          {change.diff && <DiffViewer diff={change.diff} />}
          {!change.diff && change.output && (
            <div className="dt-review-output">{change.output}</div>
          )}
        </div>
      ))}
    </div>
  )
}

// --- Files Tab (simple file tree) ---

interface FileNode {
  name: string
  type: 'file' | 'folder'
  children?: FileNode[]
}

const mockFileTree: FileNode[] = [
  {
    name: 'src', type: 'folder', children: [
      {
        name: 'components', type: 'folder', children: [
          { name: 'ChatTab.tsx', type: 'file' },
          { name: 'WorkTab.tsx', type: 'file' },
          { name: 'DevTab.tsx', type: 'file' },
          {
            name: 'dev', type: 'folder', children: [
              { name: 'MessageTimeline.tsx', type: 'file' },
              { name: 'PromptInput.tsx', type: 'file' },
              { name: 'SidePanel.tsx', type: 'file' },
              { name: 'TerminalPanel.tsx', type: 'file' },
            ]
          },
        ]
      },
      {
        name: 'services', type: 'folder', children: [
          { name: 'opencode-api.ts', type: 'file' },
          { name: 'mock-api.ts', type: 'file' },
          { name: 'real-api.ts', type: 'file' },
        ]
      },
      { name: 'App.tsx', type: 'file' },
      { name: 'main.tsx', type: 'file' },
    ]
  },
  { name: 'package.json', type: 'file' },
  { name: 'vite.config.ts', type: 'file' },
]

function FileTreeItem({ node, depth = 0 }: { node: FileNode; depth?: number }) {
  const [open, setOpen] = useState(depth < 1)
  const isFolder = node.type === 'folder'

  return (
    <div>
      <div
        className="dt-file-item"
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        onClick={() => isFolder && setOpen(!open)}
      >
        <span className="dt-file-icon">
          {isFolder ? (open ? '📂' : '📁') : '📄'}
        </span>
        <span className="dt-file-name">{node.name}</span>
      </div>
      {isFolder && open && node.children?.map((child, i) => (
        <FileTreeItem key={i} node={child} depth={depth + 1} />
      ))}
    </div>
  )
}

function FilesTab() {
  return (
    <div className="dt-files-tree">
      {mockFileTree.map((node, i) => (
        <FileTreeItem key={i} node={node} />
      ))}
    </div>
  )
}

// --- SidePanel ---

export default function SidePanel() {
  const [tab, setTab] = useState<'review' | 'files'>('review')

  return (
    <div className="dt-side-panel">
      <div className="dt-side-tabs">
        <button
          className={`dt-side-tab ${tab === 'review' ? 'active' : ''}`}
          onClick={() => setTab('review')}
        >
          Review
        </button>
        <button
          className={`dt-side-tab ${tab === 'files' ? 'active' : ''}`}
          onClick={() => setTab('files')}
        >
          Files
        </button>
      </div>
      <div className="dt-side-content">
        {tab === 'review' ? <ReviewTab /> : <FilesTab />}
      </div>
    </div>
  )
}
