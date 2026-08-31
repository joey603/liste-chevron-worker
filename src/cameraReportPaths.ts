import type { AppSettings } from './types'

/** Dossier effectif pour דוח מצלמות (dédié ou celui de דוח משמרת). */
export function getCameraReportSaveFolder(
  settings: AppSettings | null | undefined,
): string {
  return (
    settings?.cameraReportSaveFolder?.trim() ||
    settings?.shiftReportSaveFolder?.trim() ||
    ''
  )
}
