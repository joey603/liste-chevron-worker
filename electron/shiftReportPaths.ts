import fs from 'node:fs'
import path from 'node:path'

/** Miroir de src/shiftReportPaths.ts pour le process principal Electron */

const HEBREW_MONTHS = [
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

const SHIFT_LABELS: Record<string, string> = {
  morning: 'בוקר',
  afternoon: 'צוהריים',
  night: 'לילה',
}

function parseShiftReportDate(dateStr: string) {
  const trimmed = dateStr.trim().replace(/\//g, '.')
  const m = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (!m) return null
  const day = Number(m[1])
  const month = Number(m[2])
  const year = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const dd = String(day).padStart(2, '0')
  const mm = String(month).padStart(2, '0')
  return { day, month, year, formatted: `${dd}.${mm}.${year}` }
}

function hebrewMonthName(month: number): string {
  return HEBREW_MONTHS[month - 1] ?? String(month)
}

function sanitizePathSegment(segment: string): string {
  return segment.replace(/[\\/:*?"<>|]/g, '-').trim()
}

export function shiftReportRelativeDir(dateStr: string): string | null {
  const parsed = parseShiftReportDate(dateStr)
  if (!parsed) return null
  return `${sanitizePathSegment(String(parsed.year))}/${sanitizePathSegment(hebrewMonthName(parsed.month))}`
}

export function shiftReportDocxPathsForDay(dateStr: string) {
  const relativeDir = shiftReportRelativeDir(dateStr)
  const parsed = parseShiftReportDate(dateStr)
  if (!relativeDir || !parsed) return []
  return (['morning', 'afternoon', 'night'] as const).map((shift) => ({
    shift,
    fileName: `משמרת ${SHIFT_LABELS[shift]} ${parsed.formatted}.docx`,
    relativeDir,
  }))
}

export function ensureShiftReportSaveDir(
  rootFolder: string,
  relativeDir: string,
): string {
  const dir = path.join(rootFolder, ...relativeDir.split('/').filter(Boolean))
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
