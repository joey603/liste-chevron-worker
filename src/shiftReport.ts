import {
  normalizeRichLine,
  normalizeRichLines,
  plainToRichHtml,
  SHIFT_RICH_DEFAULT_FAULT_STYLE,
  SHIFT_RICH_DEFAULT_REMINDER_STYLE,
} from './shiftRichText'

export type ShiftKind = 'morning' | 'afternoon' | 'night'

export type EquipmentStatus = 'ok' | 'bad' | ''

export type DeptEquipmentRow = {
  id: string
  name: string
  status: EquipmentStatus
  notes: string
}

export type StationEquipmentRow = {
  id: string
  name: string
  quantity: number
  present: boolean
  notes: string
}

export type ShiftReport = {
  date: string
  shift: ShiftKind
  guardIn: string
  guardOut: string
  openIssues: string
  generalNotes: string
  deptEquipment: DeptEquipmentRow[]
  stationEquipment: StationEquipmentRow[]
}

export const SHIFT_LABELS: Record<ShiftKind, string> = {
  morning: 'בוקר',
  afternoon: 'צוהריים',
  night: 'לילה',
}

export const SHIFT_REMINDERS: string[] = []

export const SHIFT_JOURNAL_RULE_LEAD =
  'יש לשמר את הסדר והאחידות ביומן בכל עדכון! חובה - לציין תאריך! '
export const SHIFT_JOURNAL_RULE_HIGHLIGHT = 'נושא חדש יסומן כך.'

export const SHIFT_JOURNAL_RULE =
  SHIFT_JOURNAL_RULE_LEAD + SHIFT_JOURNAL_RULE_HIGHLIGHT

export const SHIFT_OPEN_FAULTS_FIXED: string[] = []

export type ShiftGeneralNoteFixed = {
  text: string
  underline?: boolean
  redSuffix?: string
}

export const SHIFT_GENERAL_NOTES_FIXED: ShiftGeneralNoteFixed[] = []

function generalNoteFixedToHtml(note: ShiftGeneralNoteFixed): string {
  const mainInner = plainToRichHtml(
    note.text,
    note.underline
      ? 'font-weight:600;text-decoration:underline'
      : 'font-weight:600',
  )
  if (!note.redSuffix) return mainInner
  return `${mainInner}${plainToRichHtml(
    note.redSuffix,
    'color:#ff0000;font-weight:700;text-decoration:underline',
  )}`
}

export const SHIFT_GENERAL_NOTES_HTML_DEFAULT = SHIFT_GENERAL_NOTES_FIXED.map(
  generalNoteFixedToHtml,
)

/** @deprecated use SHIFT_OPEN_FAULTS_FIXED + SHIFT_GENERAL_NOTES_FIXED */
export const SHIFT_PERMANENT_NOTES = [
  ...SHIFT_OPEN_FAULTS_FIXED,
  ...SHIFT_GENERAL_NOTES_FIXED.map((n) =>
    n.redSuffix ? `${n.text}${n.redSuffix}` : n.text,
  ),
]

/** מחרוזת בתוך הערות ציוד שמסומנת בצהוב (מוגדרת באפליקציה, לא בקוד) */
export const SHIFT_NOTE_YELLOW_HIGHLIGHT = ''

/** טקסטים קבועים של הדוח (ניתנים לעריכה באפליקציה) */
export type ShiftDeptTemplateItem = {
  id: string
  name: string
  notes: string
}

export type ShiftStationTemplateItem = {
  id: string
  name: string
  quantity: number
  notes: string
}

export type ShiftReportTexts = {
  journalRuleLead: string
  journalRuleHighlight: string
  /** HTML rich par ligne (puce affichée via <ul>) */
  reminders: string[]
  openFaultsFixed: string[]
  /** HTML rich par ligne */
  generalNotesHtml: string[]
  deptTemplate: ShiftDeptTemplateItem[]
  stationTemplate: ShiftStationTemplateItem[]
  /** שמות מאבטחים לבחירה בדוח (מוזנים ידנית בדף זה) */
  guardNames: string[]
}

function defaultDeptTemplate(): ShiftDeptTemplateItem[] {
  return DEPT_DEFAULTS.map((item) => ({
    id: item.id,
    name: item.name,
    notes: item.notes ?? '',
  }))
}

function defaultStationTemplate(): ShiftStationTemplateItem[] {
  return STATION_DEFAULTS.map((item) => ({
    id: item.id,
    name: item.name,
    quantity: item.quantity,
    notes: item.notes ?? '',
  }))
}

export function createDefaultShiftReportTexts(): ShiftReportTexts {
  return {
    journalRuleLead: SHIFT_JOURNAL_RULE_LEAD,
    journalRuleHighlight: SHIFT_JOURNAL_RULE_HIGHLIGHT,
    reminders: SHIFT_REMINDERS.map((line) =>
      plainToRichHtml(line, SHIFT_RICH_DEFAULT_REMINDER_STYLE),
    ),
    openFaultsFixed: SHIFT_OPEN_FAULTS_FIXED.map((line) =>
      plainToRichHtml(line, SHIFT_RICH_DEFAULT_FAULT_STYLE),
    ),
    generalNotesHtml: [...SHIFT_GENERAL_NOTES_HTML_DEFAULT],
    deptTemplate: defaultDeptTemplate(),
    stationTemplate: defaultStationTemplate(),
    guardNames: [],
  }
}

export function normalizeShiftReportTexts(
  raw: Partial<ShiftReportTexts> | null | undefined,
): ShiftReportTexts {
  const base = createDefaultShiftReportTexts()
  if (!raw || typeof raw !== 'object') return base

  const reminders = normalizeRichLines(
    raw.reminders,
    SHIFT_RICH_DEFAULT_REMINDER_STYLE,
    SHIFT_REMINDERS,
  )
  const openFaultsFixed = normalizeRichLines(
    raw.openFaultsFixed,
    SHIFT_RICH_DEFAULT_FAULT_STYLE,
    SHIFT_OPEN_FAULTS_FIXED,
  )
  const legacy = raw as Partial<ShiftReportTexts> & {
    generalNotesFixed?: unknown
  }
  let generalNotesHtml: string[]
  if (Array.isArray(raw.generalNotesHtml)) {
    generalNotesHtml = normalizeRichLines(
      raw.generalNotesHtml,
      undefined,
      SHIFT_GENERAL_NOTES_HTML_DEFAULT,
    )
  } else if (Array.isArray(legacy.generalNotesFixed)) {
    const migrated = legacy.generalNotesFixed.flatMap((n: unknown) => {
      if (typeof n === 'string') return [normalizeRichLine(n, 'font-weight:600')]
      if (!n || typeof n !== 'object') return []
      const note = n as {
        text?: unknown
        underline?: unknown
        redSuffix?: unknown
      }
      const text = typeof note.text === 'string' ? note.text : ''
      if (
        !text.trim() &&
        !(typeof note.redSuffix === 'string' && note.redSuffix)
      )
        return []
      return [
        generalNoteFixedToHtml({
          text,
          underline: Boolean(note.underline),
          redSuffix:
            typeof note.redSuffix === 'string' && note.redSuffix.trim()
              ? note.redSuffix
              : undefined,
        }),
      ]
    })
    generalNotesHtml =
      migrated.length > 0 ? migrated : [...SHIFT_GENERAL_NOTES_HTML_DEFAULT]
  } else {
    generalNotesHtml = [...SHIFT_GENERAL_NOTES_HTML_DEFAULT]
  }

  const deptTemplate: ShiftDeptTemplateItem[] = Array.isArray(raw.deptTemplate)
    ? raw.deptTemplate.flatMap((item, index) => {
        if (!item || typeof item !== 'object') return []
        const name = typeof item.name === 'string' ? item.name.trim() : ''
        if (!name) return []
        return [
          {
            id:
              typeof item.id === 'string' && item.id.trim()
                ? item.id
                : `dept-${index + 1}`,
            name,
            notes: typeof item.notes === 'string' ? item.notes : '',
          },
        ]
      })
    : base.deptTemplate

  const stationTemplate: ShiftStationTemplateItem[] = Array.isArray(
    raw.stationTemplate,
  )
    ? raw.stationTemplate.flatMap((item, index) => {
        if (!item || typeof item !== 'object') return []
        const name = typeof item.name === 'string' ? item.name.trim() : ''
        if (!name) return []
        return [
          {
            id:
              typeof item.id === 'string' && item.id.trim()
                ? item.id
                : `station-${index + 1}`,
            name,
            quantity:
              typeof item.quantity === 'number' && Number.isFinite(item.quantity)
                ? item.quantity
                : 1,
            notes: typeof item.notes === 'string' ? item.notes : '',
          },
        ]
      })
    : base.stationTemplate

  const guardNames = Array.isArray(raw.guardNames)
    ? [...new Set(
        raw.guardNames
          .filter((n): n is string => typeof n === 'string')
          .map((n) => n.trim())
          .filter(Boolean),
      )].sort((a, b) => a.localeCompare(b, 'he'))
    : base.guardNames

  return {
    journalRuleLead:
      typeof raw.journalRuleLead === 'string' && raw.journalRuleLead.trim()
        ? raw.journalRuleLead
        : base.journalRuleLead,
    journalRuleHighlight:
      typeof raw.journalRuleHighlight === 'string'
        ? raw.journalRuleHighlight
        : base.journalRuleHighlight,
    reminders,
    openFaultsFixed,
    generalNotesHtml,
    deptTemplate: deptTemplate.length > 0 ? deptTemplate : base.deptTemplate,
    stationTemplate:
      stationTemplate.length > 0 ? stationTemplate : base.stationTemplate,
    guardNames,
  }
}

/** Applique le modèle d’équipement au rapport (conserve statut / בפועל) */
export function applyEquipmentTemplatesToReport(
  report: ShiftReport,
  texts: ShiftReportTexts,
): ShiftReport {
  const t = normalizeShiftReportTexts(texts)
  const prevDept = new Map(report.deptEquipment.map((r) => [r.id, r]))
  const prevStation = new Map(report.stationEquipment.map((r) => [r.id, r]))
  return {
    ...report,
    deptEquipment: t.deptTemplate.map((item) => {
      const prev = prevDept.get(item.id)
      return {
        id: item.id,
        name: item.name,
        notes: item.notes,
        status: prev?.status ?? 'ok',
      }
    }),
    stationEquipment: t.stationTemplate.map((item) => {
      const prev = prevStation.get(item.id)
      return {
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        notes: item.notes,
        present: prev?.present ?? true,
      }
    }),
  }
}

export function editorLinesToList(raw: string): string[] {
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

const DEPT_DEFAULTS: Array<{ id: string; name: string; notes?: string }> = []

const STATION_DEFAULTS: Array<{
  id: string
  name: string
  quantity: number
  notes?: string
}> = []

export function formatShiftDate(d = new Date()): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}.${mm}.${yyyy}`
}

export function createEmptyShiftReport(
  now = new Date(),
  textsInput?: ShiftReportTexts | null,
): ShiftReport {
  const texts = normalizeShiftReportTexts(textsInput)
  return {
    date: formatShiftDate(now),
    shift: 'morning',
    guardIn: '',
    guardOut: '',
    openIssues: '',
    generalNotes: '',
    deptEquipment: texts.deptTemplate.map((item) => ({
      id: item.id,
      name: item.name,
      status: 'ok' as const,
      notes: item.notes,
    })),
    stationEquipment: texts.stationTemplate.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      present: true,
      notes: item.notes,
    })),
  }
}

export function normalizeShiftReport(
  raw: Partial<ShiftReport> | null | undefined,
  textsInput?: ShiftReportTexts | null,
): ShiftReport {
  const base = createEmptyShiftReport(new Date(), textsInput)
  if (!raw || typeof raw !== 'object') return base

  const shift: ShiftKind =
    raw.shift === 'morning' ||
    raw.shift === 'afternoon' ||
    raw.shift === 'night'
      ? raw.shift
      : base.shift

  const deptById = new Map(
    (Array.isArray(raw.deptEquipment) ? raw.deptEquipment : []).map((r) => [
      r.id,
      r,
    ]),
  )
  const stationById = new Map(
    (Array.isArray(raw.stationEquipment) ? raw.stationEquipment : []).map(
      (r) => [r.id, r],
    ),
  )

  return {
    date: typeof raw.date === 'string' && raw.date.trim() ? raw.date : base.date,
    shift,
    guardIn: typeof raw.guardIn === 'string' ? raw.guardIn : '',
    guardOut: typeof raw.guardOut === 'string' ? raw.guardOut : '',
    openIssues: typeof raw.openIssues === 'string' ? raw.openIssues : '',
    generalNotes: typeof raw.generalNotes === 'string' ? raw.generalNotes : '',
    deptEquipment: base.deptEquipment.map((row) => {
      const saved = deptById.get(row.id)
      if (!saved) return row
      const status: EquipmentStatus =
        saved.status === 'ok' || saved.status === 'bad' || saved.status === ''
          ? saved.status
          : row.status
      return {
        ...row,
        status,
        notes: typeof saved.notes === 'string' ? saved.notes : row.notes,
        name: typeof saved.name === 'string' && saved.name.trim() ? saved.name : row.name,
      }
    }),
    stationEquipment: base.stationEquipment.map((row) => {
      const saved = stationById.get(row.id)
      if (!saved) return row
      return {
        ...row,
        name: typeof saved.name === 'string' && saved.name.trim() ? saved.name : row.name,
        quantity:
          typeof saved.quantity === 'number' && Number.isFinite(saved.quantity)
            ? saved.quantity
            : row.quantity,
        present: typeof saved.present === 'boolean' ? saved.present : row.present,
        notes: typeof saved.notes === 'string' ? saved.notes : row.notes,
      }
    }),
  }
}
