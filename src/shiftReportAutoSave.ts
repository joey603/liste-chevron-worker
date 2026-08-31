import {
  blobToUint8Array,
  buildShiftReportDocx,
} from './shiftReportDocx'
import { getShiftReportSaveLocation } from './shiftReportPaths'
import type { ShiftReport, ShiftReportTexts } from './shiftReport'
import type { AppSettings } from './types'

/** Court délai pour regrouper les frappes rapides sans retarder la sauvegarde. */
const AUTO_SAVE_DELAY_MS = 300

type PendingSave = {
  settings: AppSettings
  report: ShiftReport
  texts: ShiftReportTexts | null | undefined
}

let saveTimer: number | null = null
let pending: PendingSave | null = null
let saving = false

export function scheduleShiftReportAutoSave(
  settings: AppSettings,
  report: ShiftReport,
  texts: ShiftReportTexts | null | undefined,
): void {
  const folder = settings.shiftReportSaveFolder?.trim()
  if (!folder || !window.listeApi?.saveShiftReportFiles) return

  pending = { settings, report, texts }
  if (saveTimer != null) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveTimer = null
    void runQueuedSave()
  }, AUTO_SAVE_DELAY_MS)
}

/** Écrit immédiatement le dernier état (changement de garde, fermeture, etc.). */
export async function flushShiftReportAutoSave(
  settings?: AppSettings,
  report?: ShiftReport,
  texts?: ShiftReportTexts | null,
): Promise<void> {
  if (settings && report) {
    pending = { settings, report, texts }
  }
  if (saveTimer != null) {
    window.clearTimeout(saveTimer)
    saveTimer = null
  }
  await runQueuedSave()
}

async function runQueuedSave(): Promise<void> {
  if (!pending || saving) return
  const job = pending
  pending = null
  const folder = job.settings.shiftReportSaveFolder?.trim()
  if (!folder) return

  saving = true
  try {
    await persistShiftReportFiles(folder, job.report, job.texts)
  } finally {
    saving = false
    if (pending) await runQueuedSave()
  }
}

export async function persistShiftReportFiles(
  folder: string,
  report: ShiftReport,
  texts: ShiftReportTexts | null | undefined,
): Promise<void> {
  if (!window.listeApi?.saveShiftReportFiles) return
  const location = getShiftReportSaveLocation(report)
  if (!location) return
  try {
    const blob = await buildShiftReportDocx(report, texts)
    const docxBytes = Array.from(await blobToUint8Array(blob))
    const json = JSON.stringify(
      { report, texts: texts ?? null, savedAt: new Date().toISOString() },
      null,
      2,
    )
    await window.listeApi.saveShiftReportFiles({
      folder,
      relativeDir: location.relativeDir,
      docxFileName: location.docxFileName,
      jsonFileName: location.jsonFileName,
      json,
      docxBytes,
    })
  } catch {
    // silencieux — la sauvegarde JSON locale reste active
  }
}
