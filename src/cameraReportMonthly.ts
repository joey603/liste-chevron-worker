import type { CameraReport } from './cameraReport'
import {
  isCameraReportPresent,
  normalizeCameraReport,
} from './cameraReport'
import type { CameraReportsArchive } from './cameraReportArchive'
import type { ShiftKind } from './shiftReport'
import {
  hebrewMonthName,
  parseShiftReportDate,
  sanitizePathSegment,
} from './shiftReportPaths'

const SHIFT_ORDER: ShiftKind[] = ['morning', 'afternoon', 'night']

export type MonthlyCameraReport = {
  month: number
  year: number
  hebrewMonth: string
  generatedAt: string
  days: Record<string, Partial<Record<ShiftKind, CameraReport>>>
}

export function getPreviousCalendarMonth(d = new Date()): {
  month: number
  year: number
} {
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1)
  return { month: prev.getMonth() + 1, year: prev.getFullYear() }
}

export function monthlyCameraReportKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

export function cameraReportMonthlyWorkbookFileName(
  year: number,
  month: number,
): string {
  return `יומן מצלמות ${hebrewMonthName(month)} ${year}.xlsx`
}

/** @deprecated JSON legacy — le fichier mensuel est désormais .xlsx */
export function cameraReportMonthlyJsonFileName(
  year: number,
  month: number,
): string {
  return `יומן מצלמות ${hebrewMonthName(month)} ${year}.json`
}

export function cameraReportMonthlyRelativeDir(
  year: number,
  month: number,
): string {
  const yearSeg = sanitizePathSegment(String(year))
  const monthSeg = sanitizePathSegment(hebrewMonthName(month))
  return `${yearSeg}/${monthSeg}`
}

export function buildMonthlyCameraReport(
  archive: CameraReportsArchive | undefined,
  year: number,
  month: number,
): MonthlyCameraReport {
  const days: MonthlyCameraReport['days'] = {}

  if (archive) {
    for (const [dateKey, dayArchive] of Object.entries(archive)) {
      const parsed = parseShiftReportDate(dateKey)
      if (!parsed || parsed.month !== month || parsed.year !== year) continue
      const dayEntry: Partial<Record<ShiftKind, CameraReport>> = {}
      for (const shift of SHIFT_ORDER) {
        const report = dayArchive?.[shift]
        if (report && isCameraReportPresent(report)) {
          dayEntry[shift] = normalizeCameraReport({
            ...report,
            date: parsed.formatted,
            shift,
          })
        }
      }
      if (Object.keys(dayEntry).length > 0) {
        days[parsed.formatted] = dayEntry
      }
    }
  }

  return {
    month,
    year,
    hebrewMonth: hebrewMonthName(month),
    generatedAt: new Date().toISOString(),
    days,
  }
}

export function mergeReportIntoMonthly(
  monthly: MonthlyCameraReport,
  report: CameraReport,
): MonthlyCameraReport {
  const parsed = parseShiftReportDate(report.date)
  if (!parsed || parsed.month !== monthly.month || parsed.year !== monthly.year) {
    return monthly
  }
  const normalized = normalizeCameraReport(report)
  if (!isCameraReportPresent(normalized)) {
    const nextDays = { ...monthly.days }
    const day = { ...(nextDays[parsed.formatted] ?? {}) }
    delete day[normalized.shift]
    if (Object.keys(day).length === 0) delete nextDays[parsed.formatted]
    else nextDays[parsed.formatted] = day
    return { ...monthly, days: nextDays, generatedAt: new Date().toISOString() }
  }
  return {
    ...monthly,
    days: {
      ...monthly.days,
      [parsed.formatted]: {
        ...(monthly.days[parsed.formatted] ?? {}),
        [normalized.shift]: normalized,
      },
    },
    generatedAt: new Date().toISOString(),
  }
}

export function monthlyCameraReportHasContent(
  monthly: MonthlyCameraReport,
): boolean {
  return Object.keys(monthly.days).length > 0
}

export function serializeMonthlyCameraReport(
  monthly: MonthlyCameraReport,
): string {
  return JSON.stringify(monthly, null, 2)
}
