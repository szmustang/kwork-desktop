import '../styles/dropdown-panel.css'

export interface DropdownOption {
  key: string
  label: string
}

export type DropdownPlacement = 'left' | 'center' | 'right'

interface DropdownPanelProps {
  options: DropdownOption[]
  value: string
  onSelect: (key: string) => void
  onClose?: () => void
  className?: string
  placement?: DropdownPlacement
}

export default function DropdownPanel({ options, value, onSelect, onClose, className, placement = 'left' }: DropdownPanelProps) {
  return (
    <>
      {onClose && (
        <div className="dropdown-panel-backdrop" onMouseDown={onClose} />
      )}
      <div className={`dropdown-panel-popover dropdown-panel-popover--${placement} ${className || ''}`}>
        <div className="dropdown-panel">
          {options.map(opt => (
            <div
              key={opt.key}
              className={`dropdown-panel-option ${opt.key === value ? 'active' : ''}`}
              onClick={() => onSelect(opt.key)}
            >
              <span className="dropdown-panel-label">{opt.label}</span>
              {opt.key === value && (
                <svg className="dropdown-panel-check" viewBox="0 0 16 16" fill="none">
                  <path d="M12.0259 3.3169C12.2353 3.01403 12.6501 2.93829 12.953 3.14763C13.2557 3.35702 13.3316 3.77189 13.1223 4.07472L7.07214 12.8286C6.95718 12.9948 6.77241 13.1007 6.57084 13.1151C6.36936 13.1294 6.17177 13.0509 6.03438 12.9028L2.75183 9.36313C2.50155 9.09321 2.51786 8.67144 2.78763 8.42107C3.05762 8.17072 3.47934 8.18624 3.72969 8.45623L6.44714 11.3872L12.0259 3.3169Z" fill="#2970FF"/>
                </svg>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
