import fs from 'node:fs'
import path from 'node:path'

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

function hebrewMonthName(month: number): string {
  return HEBREW_MONTHS[month - 1] ?? String(month)
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

export function getPreviousCalendarMonth(d = new Date()) {
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1)
  return { month: prev.getMonth() + 1, year: prev.getFullYear() }
}

export function monthlyCameraReportKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

export function cameraReportMonthlyWorkbookFileName(year: number, month: number) {
  return `יומן מצלמות ${hebrewMonthName(month)} ${year}.xlsx`
}

export function cameraReportMonthlyJsonFileName(year: number, month: number) {
  return `יומן מצלמות ${hebrewMonthName(month)} ${year}.json`
}

export function cameraReportMonthlyRelativeDir(year: number, month: number) {
  return `${year}/${hebrewMonthName(month)}`
}

export type MonthlyCameraReport = {
  month: number
  year: number
  hebrewMonth: string
  generatedAt: string
  days: Record<string, Record<string, unknown>>
}

const DAILY_FILE_RE =
  /^דוח מצלמות (בוקר|צוהריים|לילה) (\d{2}\.\d{2}\.\d{4})\.json$/

function shiftFromLabel(label: string): string | null {
  for (const [key, value] of Object.entries(SHIFT_LABELS)) {
    if (value === label) return key
  }
  return null
}

function readLegacyMonthlyJson(
  dir: string,
  year: number,
  month: number,
): MonthlyCameraReport | null {
  const filePath = path.join(
    dir,
    cameraReportMonthlyJsonFileName(year, month),
  )
  if (!fs.existsSync(filePath)) return null
  try {
    const raw = JSON.parse(
      fs.readFileSync(filePath, 'utf-8'),
    ) as MonthlyCameraReport
    if (!raw?.days || Object.keys(raw.days).length === 0) return null
    return {
      month: raw.month ?? month,
      year: raw.year ?? year,
      hebrewMonth: raw.hebrewMonth ?? hebrewMonthName(month),
      generatedAt: raw.generatedAt ?? new Date().toISOString(),
      days: raw.days,
    }
  } catch {
    return null
  }
}

function readDailyJsonFiles(
  dir: string,
  year: number,
  month: number,
): MonthlyCameraReport['days'] {
  const days: MonthlyCameraReport['days'] = {}
  if (!fs.existsSync(dir)) return days

  for (const fileName of fs.readdirSync(dir)) {
    const match = fileName.match(DAILY_FILE_RE)
    if (!match) continue
    const shift = shiftFromLabel(match[1])
    const dateFormatted = match[2]
    if (!shift) continue
    const parsed = parseShiftReportDate(dateFormatted)
    if (!parsed || parsed.month !== month || parsed.year !== year) continue
    try {
      const raw = JSON.parse(
        fs.readFileSync(path.join(dir, fileName), 'utf-8'),
      ) as { report?: unknown }
      if (!raw?.report || typeof raw.report !== 'object') continue
      days[parsed.formatted] = {
        ...(days[parsed.formatted] ?? {}),
        [shift]: raw.report,
      }
    } catch {
      /* ignore bad file */
    }
  }
  return days
}

export function buildMonthlyCameraReportFromDisk(
  rootFolder: string,
  year: number,
  month: number,
): MonthlyCameraReport | null {
  const dir = path.join(
    rootFolder,
    cameraReportMonthlyRelativeDir(year, month),
  )

  const fromMonthlyJson = readLegacyMonthlyJson(dir, year, month)
  if (fromMonthlyJson) return fromMonthlyJson

  const days = readDailyJsonFiles(dir, year, month)
  if (Object.keys(days).length === 0) return null

  return {
    month,
    year,
    hebrewMonth: hebrewMonthName(month),
    generatedAt: new Date().toISOString(),
    days,
  }
}

export function readMonthlyCameraWorkbookFile(
  rootFolder: string,
  year: number,
  month: number,
): Buffer | null {
  const filePath = path.join(
    rootFolder,
    cameraReportMonthlyRelativeDir(year, month),
    cameraReportMonthlyWorkbookFileName(year, month),
  )
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath)
}

/** @deprecated JSON legacy */
export function readMonthlyCameraReportFile(
  rootFolder: string,
  year: number,
  month: number,
): Buffer | null {
  const filePath = path.join(
    rootFolder,
    cameraReportMonthlyRelativeDir(year, month),
    cameraReportMonthlyJsonFileName(year, month),
  )
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath)
}
