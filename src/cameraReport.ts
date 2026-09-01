import type { ShiftKind } from './shiftReport'
import { formatShiftDate } from './shiftReport'

export type CameraScanEntry = {
  id: string
  /** HH:MM — התחלה */
  start: string
  /** HH:MM — סיום */
  end: string
}

export type CameraReport = {
  date: string
  shift: ShiftKind
  guardName: string
  /** HH:MM — début de la garde */
  shiftStart: string
  /** HH:MM — fin de la garde */
  shiftEnd: string
  scans: CameraScanEntry[]
}

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/

export function normalizeScanTime(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const m = trimmed.match(TIME_RE)
  if (!m) return trimmed
  return `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`
}

export function isValidScanTime(time: string): boolean {
  return TIME_RE.test(time.trim())
}

export function addMinutesToScanTime(start: string, minutes: number): string {
  const normalized = normalizeScanTime(start)
  if (!isValidScanTime(normalized)) return ''
  return minutesToScanTime(timeToMinutes(normalized) + minutes)
}

function timeToMinutes(time: string): number {
  const normalized = normalizeScanTime(time)
  if (!isValidScanTime(normalized)) return 0
  const [h, m] = normalized.split(':').map(Number)
  return h * 60 + m
}

function minutesToScanTime(totalMinutes: number): string {
  const wrapped = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60)
  const hh = String(Math.floor(wrapped / 60)).padStart(2, '0')
  const mm = String(wrapped % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

function shiftCrossesMidnight(shiftStart: string, shiftEnd: string): boolean {
  if (!isValidScanTime(shiftStart) || !isValidScanTime(shiftEnd)) return false
  return timeToMinutes(shiftEnd) <= timeToMinutes(shiftStart)
}

/** Position sur la timeline de la garde (heures après minuit = lendemain pour garde de nuit). */
export function scanTimelineMinutes(
  time: string,
  shiftStart: string,
  shiftEnd: string,
): number {
  const minutes = timeToMinutes(time)
  if (!isValidScanTime(time)) return minutes
  if (shiftCrossesMidnight(shiftStart, shiftEnd) && minutes < timeToMinutes(shiftStart)) {
    return minutes + 24 * 60
  }
  return minutes
}

export function addMinutesOnShiftTimeline(
  time: string,
  minutes: number,
  shiftStart: string,
  shiftEnd: string,
): string {
  if (!isValidScanTime(time)) return ''
  const base = scanTimelineMinutes(time, shiftStart, shiftEnd)
  return minutesToScanTime(base + minutes)
}

export function isValidScan(entry: CameraScanEntry): boolean {
  return isValidScanTime(entry.start) && isValidScanTime(entry.end)
}

export function isCameraReportPresent(
  report: Partial<CameraReport> | null | undefined,
): boolean {
  if (!report) return false
  const normalized = normalizeCameraReport(report)
  return (
    Boolean(normalized.guardName.trim()) || normalized.scans.some(isValidScan)
  )
}

function normalizeScanEntry(
  entry: Partial<CameraScanEntry> & { time?: string },
  index: number,
): CameraScanEntry | null {
  if (!entry || typeof entry !== 'object') return null

  const legacyTime = typeof entry.time === 'string' ? entry.time : ''
  const rawStart =
    typeof entry.start === 'string' && entry.start.trim()
      ? entry.start
      : legacyTime
  const rawEnd = typeof entry.end === 'string' ? entry.end : ''
  const start = normalizeScanTime(rawStart)
  const end = normalizeScanTime(rawEnd)

  if (rawStart.trim() && !isValidScanTime(start)) return null
  if (rawEnd.trim() && !isValidScanTime(end)) return null

  return {
    id:
      typeof entry.id === 'string' && entry.id.trim()
        ? entry.id
        : `scan-${index + 1}`,
    start,
    end,
  }
}

export function createEmptyCameraReport(
  now = new Date(),
  shift: ShiftKind = 'morning',
  date?: string,
): CameraReport {
  const { start, end } = getShiftDefaultHours(shift)
  return {
    date: date ?? formatShiftDate(now),
    shift,
    guardName: '',
    shiftStart: start,
    shiftEnd: end,
    scans: [],
  }
}

export function normalizeCameraReport(
  raw: Partial<CameraReport> | null | undefined,
): CameraReport {
  const base = createEmptyCameraReport()
  if (!raw || typeof raw !== 'object') return base

  const shift: ShiftKind =
    raw.shift === 'morning' ||
    raw.shift === 'afternoon' ||
    raw.shift === 'night'
      ? raw.shift
      : base.shift

  const scans = Array.isArray(raw.scans)
    ? raw.scans.flatMap((entry, index) => {
        const normalized = normalizeScanEntry(entry, index)
        return normalized ? [normalized] : []
      })
    : []

  const defaults = getShiftDefaultHours(shift)
  const rawShiftStart =
    typeof raw.shiftStart === 'string' ? raw.shiftStart.trim() : ''
  const rawShiftEnd = typeof raw.shiftEnd === 'string' ? raw.shiftEnd.trim() : ''
  const shiftStart = rawShiftStart
    ? normalizeScanTime(rawShiftStart)
    : defaults.start
  const shiftEnd = rawShiftEnd ? normalizeScanTime(rawShiftEnd) : defaults.end

  return {
    date:
      typeof raw.date === 'string' && raw.date.trim()
        ? raw.date.trim().replace(/\//g, '.')
        : base.date,
    shift,
    guardName: typeof raw.guardName === 'string' ? raw.guardName : '',
    shiftStart: isValidScanTime(shiftStart) ? shiftStart : defaults.start,
    shiftEnd: isValidScanTime(shiftEnd) ? shiftEnd : defaults.end,
    scans,
  }
}

export function sortScansByTime(
  scans: CameraScanEntry[],
  context?: Pick<CameraReport, 'shiftStart' | 'shiftEnd'>,
): CameraScanEntry[] {
  if (
    !context ||
    !isValidScanTime(context.shiftStart) ||
    !isValidScanTime(context.shiftEnd)
  ) {
    return [...scans].sort((a, b) => a.start.localeCompare(b.start))
  }
  const { shiftStart, shiftEnd } = context
  return [...scans].sort(
    (a, b) =>
      scanTimelineMinutes(a.start, shiftStart, shiftEnd) -
      scanTimelineMinutes(b.start, shiftStart, shiftEnd),
  )
}

export function formatScanRange(entry: CameraScanEntry): string {
  if (isValidScan(entry)) return `${entry.start}–${entry.end}`
  if (isValidScanTime(entry.start)) return entry.start
  if (isValidScanTime(entry.end)) return entry.end
  return ''
}

/** Garde uniquement les scans complets (début + fin) pour sauvegarde / export. */
export function cameraReportForSave(report: CameraReport): CameraReport {
  return {
    ...report,
    scans: report.scans.filter(isValidScan),
  }
}

export function createEmptyScanEntry(id: string): CameraScanEntry {
  return { id, start: '', end: '' }
}

export const SHIFT_DEFAULT_HOURS: Record<
  ShiftKind,
  { start: string; end: string }
> = {
  morning: { start: '06:00', end: '14:00' },
  afternoon: { start: '14:00', end: '22:00' },
  night: { start: '22:00', end: '06:00' },
}

export function getShiftDefaultHours(shift: ShiftKind): {
  start: string
  end: string
} {
  return SHIFT_DEFAULT_HOURS[shift]
}

export function formatShiftDefaultHours(shift: ShiftKind): string {
  const { start, end } = getShiftDefaultHours(shift)
  return `${start}–${end}`
}

export function createNextScanEntry(
  id: string,
  report: Pick<CameraReport, 'shiftStart' | 'shiftEnd' | 'scans'>,
): CameraScanEntry {
  const { shiftStart, shiftEnd } = report
  const sorted = sortScansByTime([...report.scans], { shiftStart, shiftEnd })
  const last = sorted[sorted.length - 1]

  let anchor = ''
  if (last) {
    if (isValidScanTime(last.end)) anchor = last.end
    else if (isValidScanTime(last.start)) anchor = last.start
  } else if (isValidScanTime(shiftStart)) {
    anchor = shiftStart
  }

  if (!anchor) return createEmptyScanEntry(id)

  const start = addMinutesOnShiftTimeline(anchor, 60, shiftStart, shiftEnd)
  const end = start
    ? addMinutesOnShiftTimeline(start, 5, shiftStart, shiftEnd)
    : ''

  return { id, start, end }
}
