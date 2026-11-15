import { localDateKey } from './types'

const PRESETS: { label: string; days: number }[] = [
  { label: 'יום 1', days: 1 },
  { label: '2 ימים', days: 2 },
  { label: '3 ימים', days: 3 },
  { label: 'שבוע', days: 7 },
  { label: 'שבועיים', days: 14 },
  { label: 'חודש', days: 30 },
]

export function dateFromTodayPlusDays(days: number): string {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + days)
  return localDateKey(d)
}

type Props = {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  id?: string
  label?: string
  hint?: string
}

export default function ExpiresOnPicker({
  value,
  onChange,
  disabled = false,
  id,
  label = 'תאריך סיום / יציאה',
  hint = 'ריק = ללא תפוגה.',
}: Props) {
  const activeDays = PRESETS.find(
    (p) => value && value === dateFromTodayPlusDays(p.days),
  )?.days

  return (
    <div className="field expires-picker">
      {label ? (
        <label htmlFor={id}>
          <span className="expires-picker-label">{label}</span>
        </label>
      ) : null}
      <div className="expires-presets" role="group" aria-label={label}>
        {PRESETS.map((preset) => (
          <button
            key={preset.days}
            type="button"
            className={`expires-chip ${activeDays === preset.days ? 'active' : ''}`}
            disabled={disabled}
            onClick={() => onChange(dateFromTodayPlusDays(preset.days))}
          >
            {preset.label}
          </button>
        ))}
        <button
          type="button"
          className={`expires-chip ${!value ? 'active' : ''}`}
          disabled={disabled}
          onClick={() => onChange('')}
        >
          ללא
        </button>
      </div>
      <input
        id={id}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        dir="ltr"
        disabled={disabled}
      />
      {hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  )
}
