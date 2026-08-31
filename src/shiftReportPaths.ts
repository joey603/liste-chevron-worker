import { SHIFT_LABELS, type ShiftKind, type ShiftReport } from './shiftReport'

export const HEBREW_MONTHS = [
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

export type ParsedShiftDate = {
  day: number
  month: number
  year: number
  formatted: string
}

/** Parse une date de rapport DD.MM.YYYY */
export function parseShiftReportDate(dateStr: string): ParsedShiftDate | null {
  const trimmed = dateStr.trim().replace(/\//g, '.')
  const m = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (!m) return null
  const day = Number(m[1])
  const month = Number(m[2])
  const year = Number(m[3])
  if (
    !Number.isFinite(day) ||
    !Number.isFinite(month) ||
    !Number.isFinite(year) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null
  }
  const dd = String(day).padStart(2, '0')
  const mm = String(month).padStart(2, '0')
  return { day, month, year, formatted: `${dd}.${mm}.${year}` }
}

export function hebrewMonthName(month: number): string {
  return HEBREW_MONTHS[month - 1] ?? String(month)
}

export function sanitizePathSegment(segment: string): string {
  return segment.replace(/[\\/:*?"<>|]/g, '-').trim()
}

export function shiftReportDocxFileName(
  shift: ShiftKind,
  dateFormatted: string,
): string {
  return `משמרת ${SHIFT_LABELS[shift]} ${dateFormatted}.docx`
}

export function shiftReportJsonFileName(
  shift: ShiftKind,
  dateFormatted: string,
): string {
  return `משמרת ${SHIFT_LABELS[shift]} ${dateFormatted}.json`
}

export function shiftReportFileName(report: ShiftReport): string {
  const parsed = parseShiftReportDate(report.date)
  const date = parsed?.formatted ?? report.date.replace(/\//g, '.')
  return shiftReportDocxFileName(report.shift, date)
}

/** Dossier relatif : {année}/{mois en hébreu} */
export function shiftReportRelativeDir(dateStr: string): string | null {
  const parsed = parseShiftReportDate(dateStr)
  if (!parsed) return null
  const year = sanitizePathSegment(String(parsed.year))
  const month = sanitizePathSegment(hebrewMonthName(parsed.month))
  return `${year}/${month}`
}

export function getShiftReportSaveLocation(report: ShiftReport): {
  relativeDir: string
  docxFileName: string
  jsonFileName: string
} | null {
  const parsed = parseShiftReportDate(report.date)
  if (!parsed) return null
  const relativeDir = shiftReportRelativeDir(report.date)
  if (!relativeDir) return null
  return {
    relativeDir,
    docxFileName: shiftReportDocxFileName(report.shift, parsed.formatted),
    jsonFileName: shiftReportJsonFileName(report.shift, parsed.formatted),
  }
}

/** Chemins docx des 3 gardes pour un jour (email / recherche) */
export function shiftReportDocxPathsForDay(
  dateStr: string,
): Array<{ shift: ShiftKind; fileName: string; relativeDir: string }> {
  const parsed = parseShiftReportDate(dateStr)
  if (!parsed) return []
  const relativeDir = shiftReportRelativeDir(dateStr)
  if (!relativeDir) return []
  return (['morning', 'afternoon', 'night'] as ShiftKind[]).map((shift) => ({
    shift,
    fileName: shiftReportDocxFileName(shift, parsed.formatted),
    relativeDir,
  }))
}
