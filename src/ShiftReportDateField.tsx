import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import { formatShiftDate } from './shiftReport'
import { parseShiftReportDate } from './shiftReportPaths'

const WEEKDAYS_HE = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'] as const

const MONTHS_HE = [
  'ינואר',
  'פברואר',
  'מרץ',
  'אפריל',
  'מאי',
  'יוני',
  'יולי',
  'אוגוסט',
  'ספטמבר',
  'אוקטובר',
  'נובמבר',
  'דצמבר',
] as const

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function toFormatted(year: number, month: number, day: number): string {
  return `${pad2(day)}.${pad2(month)}.${year}`
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

/** Dimanche = 0 (semaine israélienne). */
function sundayBasedWeekday(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day).getDay()
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
  const [open, setOpen] = useState(false)
  const focusedRef = useRef(false)
  const rootRef = useRef<HTMLLabelElement>(null)

  const today = formatShiftDate(new Date())

  const [viewYear, setViewYear] = useState(() => {
    const parsed = parseShiftReportDate(value)
    return parsed?.year ?? new Date().getFullYear()
  })
  const [viewMonth, setViewMonth] = useState(() => {
    const parsed = parseShiftReportDate(value)
    return parsed?.month ?? new Date().getMonth() + 1
  })

  const savedSet = useMemo(() => {
    const set = new Set<string>()
    for (const d of savedDates) {
      const parsed = parseShiftReportDate(d)
      if (parsed) set.add(parsed.formatted)
    }
    return set
  }, [savedDates])

  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(value)
    }
  }, [value])

  useEffect(() => {
    if (!open) return
    const parsed = parseShiftReportDate(draft) ?? parseShiftReportDate(value)
    if (parsed) {
      setViewYear(parsed.year)
      setViewMonth(parsed.month)
    }

    function onDocPointerDown(e: PointerEvent) {
      const root = rootRef.current
      if (!root || !(e.target instanceof Node)) return
      if (!root.contains(e.target)) setOpen(false)
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', onDocPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, draft, value])

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
    commitFormatted(parsed.formatted)
  }

  function openCalendar() {
    setOpen((prev) => !prev)
  }

  function selectDay(day: number) {
    const formatted = toFormatted(viewYear, viewMonth, day)
    commitFormatted(formatted)
    setOpen(false)
  }

  function goPrevMonth() {
    if (viewMonth === 1) {
      setViewMonth(12)
      setViewYear((y) => y - 1)
    } else {
      setViewMonth((m) => m - 1)
    }
  }

  function goNextMonth() {
    if (viewMonth === 12) {
      setViewMonth(1)
      setViewYear((y) => y + 1)
    } else {
      setViewMonth((m) => m + 1)
    }
  }

  function selectToday() {
    const formatted = formatShiftDate(new Date())
    const parsed = parseShiftReportDate(formatted)!
    setViewYear(parsed.year)
    setViewMonth(parsed.month)
    commitFormatted(formatted)
    setOpen(false)
  }

  const draftHasSaved = savedSet.has(
    parseShiftReportDate(draft)?.formatted ?? '',
  )

  const selected =
    parseShiftReportDate(draft)?.formatted ??
    parseShiftReportDate(value)?.formatted ??
    ''

  const cells = useMemo(() => {
    const total = daysInMonth(viewYear, viewMonth)
    const startPad = sundayBasedWeekday(viewYear, viewMonth, 1)
    const items: Array<
      | { type: 'empty'; key: string }
      | { type: 'day'; key: string; day: number; formatted: string }
    > = []
    for (let i = 0; i < startPad; i++) {
      items.push({ type: 'empty', key: `e-${i}` })
    }
    for (let day = 1; day <= total; day++) {
      const formatted = toFormatted(viewYear, viewMonth, day)
      items.push({ type: 'day', key: formatted, day, formatted })
    }
    return items
  }, [viewYear, viewMonth])

  return (
    <label className="shift-field shift-date-field" ref={rootRef}>
      <span>תאריך</span>
      <div className="shift-date-field-row">
        <input
          type="text"
          className="shift-date-input"
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
              setOpen(false)
            }
          }}
          placeholder="DD.MM.YYYY"
          title="הקלידו תאריך או לחצו בחר · Enter לאישור"
        />
        <button
          type="button"
          className="shift-date-action"
          onClick={(e) => {
            e.preventDefault()
            openCalendar()
          }}
          aria-expanded={open}
          aria-haspopup="dialog"
          title="בחירת תאריך מהיומן"
        >
          בחר
        </button>
      </div>

      {open ? (
        <div
          className="shift-date-calendar"
          role="dialog"
          aria-label="בחירת תאריך"
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="shift-date-calendar-nav">
            <button
              type="button"
              className="shift-date-calendar-nav-btn"
              onClick={goNextMonth}
              aria-label="חודש הבא"
            >
              ‹
            </button>
            <div className="shift-date-calendar-title">
              {MONTHS_HE[viewMonth - 1]} {viewYear}
            </div>
            <button
              type="button"
              className="shift-date-calendar-nav-btn"
              onClick={goPrevMonth}
              aria-label="חודש קודם"
            >
              ›
            </button>
          </div>

          <div className="shift-date-calendar-weekdays" aria-hidden>
            {WEEKDAYS_HE.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>

          <div className="shift-date-calendar-grid">
            {cells.map((cell) => {
              if (cell.type === 'empty') {
                return <span key={cell.key} className="shift-date-cal-empty" />
              }
              const isSelected = cell.formatted === selected
              const isToday = cell.formatted === today
              const hasSaved = savedSet.has(cell.formatted)
              return (
                <button
                  key={cell.key}
                  type="button"
                  className={[
                    'shift-date-cal-day',
                    isSelected ? 'is-selected' : '',
                    isToday ? 'is-today' : '',
                    hasSaved ? 'has-saved' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => selectDay(cell.day)}
                  title={
                    hasSaved
                      ? `${cell.formatted} · יש דוח שמור`
                      : cell.formatted
                  }
                >
                  <span className="shift-date-cal-day-num">{cell.day}</span>
                </button>
              )
            })}
          </div>

          <div className="shift-date-calendar-footer">
            <button
              type="button"
              className="shift-date-calendar-footer-btn"
              onClick={selectToday}
            >
              היום
            </button>
            <button
              type="button"
              className="shift-date-calendar-footer-btn is-muted"
              onClick={() => setOpen(false)}
            >
              ביטול
            </button>
          </div>
        </div>
      ) : null}

      {draftHasSaved ? (
        <span className="shift-date-saved-hint">יש דוח שמור לתאריך זה</span>
      ) : (
        <span className="shift-date-saved-hint is-placeholder" aria-hidden>
          &nbsp;
        </span>
      )}
    </label>
  )
}
