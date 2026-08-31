import { useEffect, useRef, useState } from 'react'

export default function GuardNameField({
  label,
  value,
  names,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  names: string[]
  onChange: (name: string) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <label className="shift-field shift-field-guard">
      <span>{label}</span>
      <div className="shift-guard-row">
        <input
          type="text"
          className="shift-guard-input"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        <div className="shift-guard-dropdown" ref={wrapRef}>
          <button
            type="button"
            className="shift-guard-picker-btn"
            aria-expanded={open}
            aria-haspopup="listbox"
            title="בחר עובד מהרשימה"
            onClick={() => setOpen((v) => !v)}
          >
            <span aria-hidden>▾</span>
          </button>
          {open ? (
            <div
              className="shift-guard-dropdown-menu"
              role="listbox"
              aria-label={label}
            >
              {names.length > 0 ? (
                names.map((name) => (
                  <button
                    key={name}
                    type="button"
                    role="option"
                    aria-selected={value.trim() === name}
                    className={`shift-guard-option${
                      value.trim() === name ? ' is-selected' : ''
                    }`}
                    onClick={() => {
                      onChange(name)
                      setOpen(false)
                    }}
                  >
                    {name}
                  </button>
                ))
              ) : (
                <p className="shift-guard-empty">
                  אין שמות — הוסיפו בהגדרות דוח משמרת או ברשימת העובדים
                </p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </label>
  )
}
