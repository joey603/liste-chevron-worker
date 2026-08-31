import type { CameraReport } from './cameraReport'
import { createEmptyCameraReport, isValidScan } from './cameraReport'
import type { ShiftKind } from './shiftReport'
import type { ShiftReportsArchive } from './shiftReportArchive'
import { getOperationalDayDate } from './shiftReportArchive'

export type CameraDayArchive = Partial<Record<ShiftKind, CameraReport>>

export type CameraReportsArchive = Record<string, CameraDayArchive>

export { getOperationalDayDate }

export function upsertCameraInArchive(
  archive: CameraReportsArchive | undefined,
  report: CameraReport,
): CameraReportsArchive {
  const next: CameraReportsArchive = { ...(archive ?? {}) }
  const dayKey = report.date.trim()
  if (!dayKey) return next
  const day: CameraDayArchive = { ...(next[dayKey] ?? {}) }
  day[report.shift] = report
  next[dayKey] = day
  return next
}

export function getCameraFromArchive(
  archive: CameraReportsArchive | undefined,
  date: string,
  shift: ShiftKind,
  shiftReportsArchive?: ShiftReportsArchive,
): CameraReport {
  const dayKey = date.trim()
  const guardFromShift =
    shiftReportsArchive?.[dayKey]?.[shift]?.guardIn?.trim() ?? ''
  const existing = archive?.[dayKey]?.[shift]
  if (existing) {
    const guardName = existing.guardName?.trim() || guardFromShift
    return { ...existing, date: dayKey, shift, guardName }
  }
  return {
    ...createEmptyCameraReport(new Date(), shift, dayKey),
    date: dayKey,
    shift,
    guardName: guardFromShift,
  }
}

export function applyCameraGuardFromShift(
  cameraArchive: CameraReportsArchive | undefined,
  cameraReport: CameraReport | undefined,
  date: string,
  shift: ShiftKind,
  guardName: string,
): {
  cameraReportsArchive: CameraReportsArchive
  cameraReport?: CameraReport
} {
  const trimmed = guardName.trim()
  const dayKey = date.trim()
  if (!trimmed || !dayKey) {
    return { cameraReportsArchive: cameraArchive ?? {}, cameraReport }
  }

  const syncedReport: CameraReport = {
    ...getCameraFromArchive(cameraArchive, dayKey, shift),
    guardName: trimmed,
  }
  const cameraReportsArchive = upsertCameraInArchive(cameraArchive, syncedReport)

  let nextCameraReport = cameraReport
  if (
    cameraReport &&
    cameraReport.date.trim() === dayKey &&
    cameraReport.shift === shift
  ) {
    nextCameraReport = { ...cameraReport, guardName: trimmed }
  }

  return { cameraReportsArchive, cameraReport: nextCameraReport }
}

export function isCameraReportFilled(
  report: CameraReport | null | undefined,
): boolean {
  if (!report?.guardName?.trim()) return false
  return report.scans.some(isValidScan)
}

export type CameraDayStatusItem = {
  shift: ShiftKind
  filled: boolean
  guardName: string
  scanCount: number
  isActive: boolean
}

export function getCameraDayStatus(
  archive: CameraReportsArchive | undefined,
  date: string,
  current: CameraReport,
): CameraDayStatusItem[] {
  const day = archive?.[date.trim()] ?? {}
  return (['morning', 'afternoon', 'night'] as ShiftKind[]).map((shift) => {
    const fromArchive = day[shift]
    const report =
      current.date.trim() === date.trim() && current.shift === shift
        ? current
        : fromArchive
    const scans = report?.scans ?? []
    return {
      shift,
      filled: isCameraReportFilled(report),
      guardName: report?.guardName?.trim() ?? '',
      scanCount: scans.filter(isValidScan).length,
      isActive: current.date.trim() === date.trim() && current.shift === shift,
    }
  })
}
