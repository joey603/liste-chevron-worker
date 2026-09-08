import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { formatShiftDate } from './shiftReport'
import { parseShiftReportDate } from './shiftReportPaths'

function toIsoDate(value: string): string {
  const parsed = parseShiftReportDate(value)
  if (!parsed) return ''
  return `${parsed.year}-${String(parsed.month).padStart(2, '0')}-${String(parsed.day).padStart(2, '0')}`
}

function fromIsoDate(iso: string): string | null {
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return `${m[3]}.${m[2]}.${m[1]}`
}

export default function ShiftReportDateField({
  value,
  onCommit,
  onInvalid,
  savedDates = [],
}: {
  value: string
  onCommit: (formatted: string) => void
  onInvalid?: () => void
  /** תאריכים שכבר יש להם דוח שמור (DD.MM.YYYY) */
  savedDates?: string[]
}) {
  const [draft, setDraft] = useState(value)
  const focusedRef = useRef(false)
  const pickerRef = useRef<HTMLInputElement>(null)

  const savedSet = useMemo(() => {
    const set = new Set<string>()
    for (const d of savedDates) {
      const parsed = parseShiftReportDate(d)
      if (parsed) set.add(parsed.formatted)
    }
    return set
  }, [savedDates])

  const savedSorted = useMemo(
    () =>
      [...savedSet].sort((a, b) => {
        const pa = parseShiftReportDate(a)
        const pb = parseShiftReportDate(b)
        if (!pa || !pb) return a.localeCompare(b)
        return (
          pa.year - pb.year || pa.month - pb.month || pa.day - pb.day
        )
      }),
    [savedSet],
  )

  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(value)
    }
  }, [value])

  function commitFormatted(formatted: string) {
    setDraft(formatted)
    if (formatted !== value.trim()) {
      onCommit(formatted)
    }
  }

  function commitFromText(raw: string) {
    const parsed = parseShiftReportDate(raw)
    if (!parsed) {
      setDraft(value)
      onInvalid?.()
      return
    }
    // Même comportement que le calendrier : charge le דוח sauvegardé si présent
    commitFormatted(parsed.formatted)
  }

  function onDraftChange(raw: string) {
    const next = raw.replace(/\//g, '.')
    setDraft(next)
    // Choix dans la liste des dates sauvegardées → chargement immédiat
    const parsed = parseShiftReportDate(next)
    if (
      parsed &&
      savedSet.has(parsed.formatted) &&
      parsed.formatted !== value.trim()
    ) {
      commitFormatted(parsed.formatted)
    }
  }

  function openCalendar() {
    const el = pickerRef.current
    if (!el) return
    try {
      if (typeof el.showPicker === 'function') {
        el.showPicker()
        return
      }
    } catch {
      /* fall through */
    }
    el.click()
  }

  const draftHasSaved = savedSet.has(
    parseShiftReportDate(draft)?.formatted ?? '',
  )

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
            onDraftChange(e.target.value)
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
          title="הקלידו תאריך או בחרו מהיומן · Enter לאישור"
          list={savedSorted.length > 0 ? 'shift-saved-dates' : undefined}
        />
        {savedSorted.length > 0 ? (
          <datalist id="shift-saved-dates">
            {savedSorted.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        ) : null}
        <input
          ref={pickerRef}
          type="date"
          className="shift-date-picker-hidden"
          tabIndex={-1}
          aria-hidden
          value={toIsoDate(draft) || toIsoDate(value)}
          onChange={(e) => {
            if (!e.target.value) return
            const formatted = fromIsoDate(e.target.value)
            if (!formatted) return
            commitFormatted(formatted)
          }}
        />
        <button
          type="button"
          className="btn btn-ghost shift-date-pick"
          onClick={openCalendar}
          title="בחירת תאריך מהיומן"
        >
          בחר
        </button>
        <button
          type="button"
          className="btn btn-ghost shift-date-today"
          onClick={() => commitFormatted(formatShiftDate(new Date()))}
          title="מעבר להיום"
        >
          היום
        </button>
      </div>
      {draftHasSaved ? (
        <span className="shift-date-saved-hint">יש דוח שמור לתאריך זה</span>
      ) : null}
    </label>
  )
}
