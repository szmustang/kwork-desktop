import '../styles/confirm-dialog.css'

interface ConfirmDialogProps {
  visible: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({ visible, title, message, confirmText = '确定', cancelText = '取消', onConfirm, onCancel }: ConfirmDialogProps) {
  if (!visible) return null

  return (
    <>
      <div className="confirm-dialog-overlay" onClick={onCancel} />
      <div className="confirm-dialog">
        <div className="confirm-dialog-title">{title}</div>
        <div className="confirm-dialog-message">{message}</div>
        <div className="confirm-dialog-actions">
          <button className="confirm-dialog-btn confirm-dialog-btn--cancel" onClick={onCancel}>
            {cancelText}
          </button>
          <button className="confirm-dialog-btn confirm-dialog-btn--ok" onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </>
  )
}
