import type { CameraReport } from './cameraReport'
import type { CameraReportsArchive } from './cameraReportArchive'
import {
  buildMonthlyCameraReport,
  cameraReportMonthlyRelativeDir,
  cameraReportMonthlyWorkbookFileName,
  mergeReportIntoMonthly,
} from './cameraReportMonthly'
import { getCameraReportSaveFolder } from './cameraReportPaths'
import { parseShiftReportDate } from './shiftReportPaths'
import type { AppSettings } from './types'

const AUTO_SAVE_DELAY_MS = 900

type PendingSave = {
  settings: AppSettings
  report: CameraReport
  archive: CameraReportsArchive | undefined
}

let saveTimer: number | null = null
let pending: PendingSave | null = null
let saving = false

export function scheduleCameraReportAutoSave(
  settings: AppSettings,
  report: CameraReport,
  archive?: CameraReportsArchive,
): void {
  if (!getCameraReportSaveFolder(settings)) return
  if (!window.listeApi?.saveCameraReportWorkbook) return

  pending = { settings, report, archive }
  if (saveTimer != null) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveTimer = null
    void runQueuedSave()
  }, AUTO_SAVE_DELAY_MS)
}

export async function flushCameraReportAutoSave(
  settings?: AppSettings,
  report?: CameraReport,
  archive?: CameraReportsArchive,
): Promise<{ ok: boolean; error?: string; path?: string }> {
  if (settings && report) {
    pending = { settings, report, archive }
  }
  if (saveTimer != null) {
    window.clearTimeout(saveTimer)
    saveTimer = null
  }
  return runQueuedSave()
}

async function runQueuedSave(): Promise<{
  ok: boolean
  error?: string
  path?: string
}> {
  if (!pending || saving) return { ok: false, error: 'nothing_pending' }
  const job = pending
  pending = null
  const folder = getCameraReportSaveFolder(job.settings)
  if (!folder) return { ok: false, error: 'no_folder' }

  saving = true
  try {
    return await persistCameraMonthlyWorkbook(folder, job.report, job.archive)
  } finally {
    saving = false
    if (pending) return runQueuedSave()
  }
}

export async function persistCameraMonthlyWorkbook(
  folder: string,
  report: CameraReport,
  archive?: CameraReportsArchive,
): Promise<{ ok: boolean; error?: string; path?: string }> {
  if (!window.listeApi?.saveCameraReportWorkbook) {
    return { ok: false, error: 'api_unavailable' }
  }
  const parsed = parseShiftReportDate(report.date)
  if (!parsed) return { ok: false, error: 'invalid_date' }

  const relativeDir = cameraReportMonthlyRelativeDir(parsed.year, parsed.month)
  const fileName = cameraReportMonthlyWorkbookFileName(parsed.year, parsed.month)

  let monthly = buildMonthlyCameraReport(archive, parsed.year, parsed.month)
  monthly = mergeReportIntoMonthly(monthly, report)

  try {
    const result = await window.listeApi.saveCameraReportWorkbook({
      folder,
      relativeDir,
      fileName,
      year: parsed.year,
      month: parsed.month,
      archive: archive ?? {},
      currentReport: report,
    })
    if (!result.ok) {
      return { ok: false, error: result.error ?? 'save_failed' }
    }
    return { ok: true, path: `${folder}/${relativeDir}/${fileName}` }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'save_failed',
    }
  }
}
