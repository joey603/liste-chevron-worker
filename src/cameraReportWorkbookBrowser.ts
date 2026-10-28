import type { CameraReportsArchive } from './cameraReportArchive'
import type { CameraReport } from './cameraReport'

/** Sauvegarde JSON du mois (persistance web) — le classeur Excel complet reste côté Electron. */
export async function buildCameraMonthlyJsonBytes(input: {
  year: number
  month: number
  archive: CameraReportsArchive
  currentReport: CameraReport
}): Promise<Uint8Array> {
  const text = JSON.stringify(
    {
      year: input.year,
      month: input.month,
      archive: input.archive,
      currentReport: input.currentReport,
      savedAt: new Date().toISOString(),
    },
    null,
    2,
  )
  return new TextEncoder().encode(text)
}

export function cameraMonthlyJsonFileName(xlsxName: string): string {
  return xlsxName.replace(/\.xlsx$/i, '.json')
}
