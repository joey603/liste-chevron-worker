import type { ShiftKind, ShiftReport, ShiftReportTexts } from './shiftReport'
import {
  createEmptyShiftReport,
  formatShiftDate,
  isShiftReportStaffed,
} from './shiftReport'
import { parseShiftReportDate } from './shiftReportPaths'

export type ShiftDayArchive = Partial<Record<ShiftKind, ShiftReport>>

export type ShiftReportsArchive = Record<string, ShiftDayArchive>

const SHIFT_ORDER: ShiftKind[] = ['morning', 'afternoon', 'night']

/** Clé archive normalisée DD.MM.YYYY (accepte aussi 7.9.2026, 07/09/2026…). */
export function normalizeArchiveDateKey(date: string): string | null {
  return parseShiftReportDate(date)?.formatted ?? null
}

/** Trouve le jour en archive même si la clé n’a pas le même format. */
export function resolveArchiveDay(
  archive: ShiftReportsArchive | undefined,
  date: string,
): { key: string; day: ShiftDayArchive } | null {
  if (!archive) return null
  const normalized = normalizeArchiveDateKey(date)
  if (!normalized) return null
  if (archive[normalized]) {
    return { key: normalized, day: archive[normalized]! }
  }
  const trimmed = date.trim()
  if (trimmed && archive[trimmed]) {
    return { key: trimmed, day: archive[trimmed]! }
  }
  for (const [key, day] of Object.entries(archive)) {
    if (normalizeArchiveDateKey(key) === normalized) {
      return { key, day: day ?? {} }
    }
  }
  return null
}

export function archiveHasSavedShifts(
  archive: ShiftReportsArchive | undefined,
  date: string,
): boolean {
  const resolved = resolveArchiveDay(archive, date)
  if (!resolved) return false
  return SHIFT_ORDER.some((shift) => isShiftReportStaffed(resolved.day[shift]))
}

/** Dates (DD.MM.YYYY) pour lesquelles un fichier Word a été / sera sauvegardé. */
export function listArchiveSavedDates(
  archive: ShiftReportsArchive | undefined,
): string[] {
  if (!archive) return []
  const keys = new Set<string>()
  for (const key of Object.keys(archive)) {
    const normalized = normalizeArchiveDateKey(key)
    if (!normalized) continue
    const day = resolveArchiveDay(archive, normalized)?.day
    if (!day) continue
    if (SHIFT_ORDER.some((shift) => isShiftReportStaffed(day[shift]))) {
      keys.add(normalized)
    }
  }
  return [...keys].sort((a, b) => {
    const pa = parseShiftReportDate(a)
    const pb = parseShiftReportDate(b)
    if (!pa || !pb) return a.localeCompare(b)
    return pa.year - pb.year || pa.month - pb.month || pa.day - pb.day
  })
}

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
  const dayKey =
    normalizeArchiveDateKey(report.date) ?? report.date.trim()
  if (!dayKey) return next
  const existing = resolveArchiveDay(next, dayKey)
  const day: ShiftDayArchive = { ...(existing?.day ?? {}) }
  // Évite les doublons de clés (07.09 vs 7.9)
  if (existing && existing.key !== dayKey) {
    delete next[existing.key]
  }
  const normalizedReport = { ...report, date: dayKey }
  day[report.shift] = normalizedReport
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
  const normalized = normalizeArchiveDateKey(date) ?? date.trim()
  const resolved = resolveArchiveDay(archive, normalized)
  const existing = resolved?.day?.[shift]
  if (existing) {
    return { ...existing, date: normalized, shift }
  }
  return {
    ...createEmptyShiftReport(new Date(), texts),
    date: normalized,
    shift,
  }
}

export function listShiftsForDay(
  archive: ShiftReportsArchive | undefined,
  date: string,
): ShiftKind[] {
  const resolved = resolveArchiveDay(archive, date)
  if (!resolved) return []
  return SHIFT_ORDER.filter((s) => resolved.day[s] != null)
}

/** Rapport considéré rempli si au moins un gardien (entrant ou sortant) est renseigné. */
export function isShiftReportFilled(
  report: ShiftReport | null | undefined,
): boolean {
  return isShiftReportStaffed(report)
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
  const dayKey = normalizeArchiveDateKey(date) ?? date.trim()
  const day = resolveArchiveDay(archive, dayKey)?.day ?? {}
  const currentKey =
    normalizeArchiveDateKey(current.date) ?? current.date.trim()
  return SHIFT_ORDER.map((shift) => {
    const fromArchive = day[shift]
    const report =
      currentKey === dayKey && current.shift === shift ? current : fromArchive
    return {
      shift,
      filled: isShiftReportFilled(report),
      guardName: report?.guardIn?.trim() ?? '',
      isActive: currentKey === dayKey && current.shift === shift,
    }
  })
}
