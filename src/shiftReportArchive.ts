import type { ShiftKind, ShiftReport, ShiftReportTexts } from './shiftReport'
import { createEmptyShiftReport, formatShiftDate } from './shiftReport'
import { parseShiftReportDate } from './shiftReportPaths'

export type ShiftDayArchive = Partial<Record<ShiftKind, ShiftReport>>

export type ShiftReportsArchive = Record<string, ShiftDayArchive>

const SHIFT_ORDER: ShiftKind[] = ['morning', 'afternoon', 'night']

/** Garde suivante le même jour (בוקר → צוהריים, צוהריים → לילה). */
export function getNextShift(shift: ShiftKind): ShiftKind | null {
  const index = SHIFT_ORDER.indexOf(shift)
  if (index < 0 || index >= SHIFT_ORDER.length - 1) return null
  return SHIFT_ORDER[index + 1]
}

/** Contexte suivant : בוקר → צוהריים → לילה → בוקר du lendemain. */
export function getNextShiftContext(
  date: string,
  shift: ShiftKind,
): { date: string; shift: ShiftKind } {
  const nextShift = getNextShift(shift)
  if (nextShift) {
    return { date: date.trim(), shift: nextShift }
  }
  const parsed = parseShiftReportDate(date)
  if (parsed) {
    const nextDay = new Date(parsed.year, parsed.month - 1, parsed.day + 1)
    return { date: formatShiftDate(nextDay), shift: 'morning' }
  }
  return { date: date.trim(), shift: 'morning' }
}

/**
 * Jour opérationnel du rapport.
 * La garde de nuit entre 00h00 et 05h59 appartient au jour calendaire précédent
 * (ex. nuit du 28.09 reste le 28, même à 01h00 le 29.09).
 */
export function getOperationalDayDate(
  now = new Date(),
  shift: ShiftKind = 'morning',
): string {
  if (shift === 'night') {
    const hour = now.getHours()
    if (hour < 6) {
      const d = new Date(now)
      d.setDate(d.getDate() - 1)
      return formatShiftDate(d)
    }
  }
  return formatShiftDate(now)
}

export function upsertShiftInArchive(
  archive: ShiftReportsArchive | undefined,
  report: ShiftReport,
  texts?: ShiftReportTexts | null,
): ShiftReportsArchive {
  const next: ShiftReportsArchive = { ...(archive ?? {}) }
  const dayKey = report.date.trim()
  if (!dayKey) return next
  const day: ShiftDayArchive = { ...(next[dayKey] ?? {}) }
  day[report.shift] = report
  next[dayKey] = day

  const nextShift = getNextShift(report.shift)
  if (!nextShift) return next

  const guardIn = report.guardIn.trim()
  const nextShiftReport =
    day[nextShift] ?? getShiftFromArchive(next, dayKey, nextShift, texts)
  if (nextShiftReport.guardOut === guardIn) return next

  day[nextShift] = { ...nextShiftReport, guardOut: guardIn }
  next[dayKey] = day
  return next
}

export function getShiftFromArchive(
  archive: ShiftReportsArchive | undefined,
  date: string,
  shift: ShiftKind,
  texts?: ShiftReportTexts | null,
): ShiftReport {
  const existing = archive?.[date]?.[shift]
  if (existing) {
    return { ...existing, date, shift }
  }
  return {
    ...createEmptyShiftReport(new Date(), texts),
    date,
    shift,
  }
}

export function listShiftsForDay(
  archive: ShiftReportsArchive | undefined,
  date: string,
): ShiftKind[] {
  const day = archive?.[date]
  if (!day) return []
  return (['morning', 'afternoon', 'night'] as ShiftKind[]).filter(
    (s) => day[s] != null,
  )
}

/** Rapport considéré rempli si le gardien entrant a indiqué son nom */
export function isShiftReportFilled(
  report: ShiftReport | null | undefined,
): boolean {
  return Boolean(report?.guardIn?.trim())
}

export type ShiftDayStatusItem = {
  shift: ShiftKind
  filled: boolean
  guardName: string
  isActive: boolean
}

export function getShiftDayStatus(
  archive: ShiftReportsArchive | undefined,
  date: string,
  current: ShiftReport,
): ShiftDayStatusItem[] {
  const day = archive?.[date.trim()] ?? {}
  return (['morning', 'afternoon', 'night'] as ShiftKind[]).map((shift) => {
    const fromArchive = day[shift]
    const report =
      current.date.trim() === date.trim() && current.shift === shift
        ? current
        : fromArchive
    return {
      shift,
      filled: isShiftReportFilled(report),
      guardName: report?.guardIn?.trim() ?? '',
      isActive: current.date.trim() === date.trim() && current.shift === shift,
    }
  })
}
