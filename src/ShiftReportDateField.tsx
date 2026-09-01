import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { parseShiftReportDate } from './shiftReportPaths'

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

  function commit() {
    const parsed = parseShiftReportDate(draft)
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

  return (
    <label className="shift-field">
      <span>תאריך</span>
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
          commit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
          if (e.key === 'Escape') {
            setDraft(value)
            e.currentTarget.blur()
          }
        }}
        placeholder="DD.MM.YYYY"
        title="ניתן לערוך ידנית · Enter לאישור"
      />
    </label>
  )
}
