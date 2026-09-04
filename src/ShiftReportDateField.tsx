import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { formatShiftDate } from './shiftReport'
import { parseShiftReportDate } from './shiftReportPaths'

function toIsoDate(value: string): string {
  const parsed = parseShiftReportDate(value)
  if (!parsed) return ''
  return `${parsed.year}-${String(parsed.month).padStart(2, '0')}-${String(parsed.day).padStart(2, '0')}`
}

export default function ShiftReportDateField({
  value,
  onCommit,
  onInvalid,
}: {
  value: string
  onCommit: (formatted: string) => void
  onInvalid?: () => void
}) {
  const [draft, setDraft] = useState(value)
  const focusedRef = useRef(false)

  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(value)
    }
  }, [value])

  function commitFromText(raw: string) {
    const parsed = parseShiftReportDate(raw)
    if (!parsed) {
      setDraft(value)
      onInvalid?.()
      return
    }
    setDraft(parsed.formatted)
    if (parsed.formatted !== value.trim()) {
      onCommit(parsed.formatted)
    }
  }

  function commitFormatted(formatted: string) {
    setDraft(formatted)
    if (formatted !== value.trim()) {
      onCommit(formatted)
    }
  }

  return (
    <label className="shift-field shift-date-field">
      <span>תאריך</span>
      <div className="shift-date-field-row">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            setDraft(e.target.value.replace(/\//g, '.'))
          }
          onFocus={() => {
            focusedRef.current = true
          }}
          onBlur={() => {
            focusedRef.current = false
            commitFromText(draft)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitFromText(draft)
            }
            if (e.key === 'Escape') {
              setDraft(value)
              e.currentTarget.blur()
            }
          }}
          placeholder="DD.MM.YYYY"
          title="ניתן לערוך ידנית · Enter לאישור"
        />
        <input
          type="date"
          className="shift-date-picker"
          value={toIsoDate(draft) || toIsoDate(value)}
          onChange={(e) => {
            if (!e.target.value) return
            const [year, month, day] = e.target.value.split('-').map(Number)
            if (!year || !month || !day) return
            commitFormatted(
              `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`,
            )
          }}
          title="בחירת תאריך מהיומן"
          aria-label="בחירת תאריך מהיומן"
        />
        <button
          type="button"
          className="btn btn-ghost shift-date-today"
          onClick={() => commitFormatted(formatShiftDate(new Date()))}
          title="איפוס להיום"
        >
          היום
        </button>
      </div>
    </label>
  )
}
