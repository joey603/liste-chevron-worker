import {
  deleteFileIfExists,
  isElectronApp,
  isWebFolderSupported,
  pickExportFolder,
  readBytesFile,
  resolveWebDir,
  WEB_FOLDER_CAMERAS,
  WEB_FOLDER_ROOT,
  WEB_FOLDER_SHIFTS,
  writeBytesFile,
} from './webDataFolder'
import { shiftReportDocxPathsForDay } from './shiftReportPaths'
import {
  mergeShiftIntoMain,
  SHIFT_REPORT_LOCAL_STORAGE_KEY,
} from './shiftReportLocalStore'
import {
  buildCameraMonthlyJsonBytes,
  cameraMonthlyJsonFileName,
} from './cameraReportWorkbookBrowser'
import { normalizeData, type ListeApi } from './types'
import {
  sendShiftReportTestEmail,
  sendShiftReportsEmail,
  sendTelegramPhoto,
  sendTelegramText,
  testTelegram,
} from './webRelay'

function noopUnsub() {
  return () => {}
}

/** Installe une API fichier navigateur si Electron est absent. */
export function installWebListeApi(): void {
  if (isElectronApp()) return
  if (!isWebFolderSupported()) return
  if (
    window.listeApi &&
    (window as Window & { __listeWebBridge?: boolean }).__listeWebBridge
  ) {
    return
  }

  const api: ListeApi = {
    getData: async () => {
      throw new Error('use_app_loadData')
    },
    saveData: async () => false,
    copyImage: async (dataUrl) => {
      try {
        const res = await fetch(dataUrl)
        const blob = await res.blob()
        await navigator.clipboard.write([
          new ClipboardItem({ [blob.type]: blob }),
        ])
        return true
      } catch {
        return false
      }
    },
    sendTelegramText,
    sendTelegramPhoto,
    testTelegram,
    getAppVersion: async () =>
      typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'web',
    checkForUpdates: async () => ({
      status: 'up-to-date',
      currentVersion:
        typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'web',
    }),
    getPendingUpdate: async () => null,
    downloadUpdate: async () => false,
    installUpdate: async () => false,
    pickFolder: async (kind) => {
      const picked = await pickExportFolder(kind === 'camera' ? 'camera' : 'shift')
      if (!picked.ok) {
        return { ok: false, canceled: picked.canceled }
      }
      return { ok: true, path: picked.path }
    },
    saveBytes: async (payload) => {
      const dir = await resolveWebDir(WEB_FOLDER_ROOT, '', true)
      if (!dir) return { ok: false }
      try {
        await writeBytesFile(
          dir,
          payload.defaultName,
          Uint8Array.from(payload.bytes),
        )
        return { ok: true, path: `${WEB_FOLDER_ROOT}/${payload.defaultName}` }
      } catch {
        return { ok: false }
      }
    },
    saveShiftReportFiles: async (payload) => {
      const folder = payload.folder?.trim() || WEB_FOLDER_SHIFTS
      const dir = await resolveWebDir(folder, payload.relativeDir, true, 'shift')
      if (!dir) return { ok: false, error: 'no_data_folder' }
      try {
        await writeBytesFile(
          dir,
          payload.jsonFileName,
          new TextEncoder().encode(payload.json),
        )
        await writeBytesFile(
          dir,
          payload.docxFileName,
          Uint8Array.from(payload.docxBytes),
        )
        return { ok: true }
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'save_failed',
        }
      }
    },
    deleteShiftReportFiles: async (payload) => {
      const folder = payload.folder?.trim() || WEB_FOLDER_SHIFTS
      const dir = await resolveWebDir(folder, payload.relativeDir, false, 'shift')
      if (!dir) return { ok: true }
      await deleteFileIfExists(dir, payload.docxFileName)
      await deleteFileIfExists(dir, payload.jsonFileName)
      return { ok: true }
    },
    saveCameraReportWorkbook: async (payload) => {
      const folder = payload.folder?.trim() || WEB_FOLDER_CAMERAS
      const dir = await resolveWebDir(
        folder,
        payload.relativeDir,
        true,
        'camera',
      )
      if (!dir) return { ok: false, error: 'no_data_folder' }
      try {
        const jsonName = cameraMonthlyJsonFileName(payload.fileName)
        const bytes = await buildCameraMonthlyJsonBytes({
          year: payload.year,
          month: payload.month,
          archive: payload.archive as never,
          currentReport: payload.currentReport as never,
        })
        await writeBytesFile(dir, jsonName, bytes)
        return { ok: true }
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'save_failed',
        }
      }
    },
    sendShiftReportTestEmail,
    sendShiftReportsEmail,
    getShiftReportEmailStatus: async () => ({ sent: false }),
    getShiftReportEmailSentLog: async () => [],
    sendShiftReportEmail: async (payload) => {
      let settings
      try {
        const main = JSON.parse(
          localStorage.getItem('liste-chevron-data') ?? 'null',
        )
        const local = JSON.parse(
          localStorage.getItem(SHIFT_REPORT_LOCAL_STORAGE_KEY) ?? 'null',
        )
        settings = normalizeData(
          mergeShiftIntoMain((main as object) ?? {}, (local as object) ?? {}),
        ).settings
      } catch {
        return { ok: false, error: 'missing_config' }
      }
      const to = settings.directorEmail?.trim() ?? ''
      if (!to) return { ok: false, error: 'missing_config' }
      const folder = settings.shiftReportSaveFolder?.trim() || WEB_FOLDER_SHIFTS
      const attachments: Array<{ name: string; bytes: number[] }> = []
      for (const item of shiftReportDocxPathsForDay(payload.date)) {
        const dir = await resolveWebDir(folder, item.relativeDir, false, 'shift')
        if (!dir) continue
        const bytes = await readBytesFile(dir, item.fileName)
        if (!bytes?.length) continue
        attachments.push({ name: item.fileName, bytes: Array.from(bytes) })
      }
      if (attachments.length === 0) {
        return { ok: false, error: 'no_attachments' }
      }
      const result = await sendShiftReportsEmail({
        date: payload.date,
        directorEmail: to,
        smtpHost: settings.shiftReportSmtpHost ?? '',
        smtpPort: settings.shiftReportSmtpPort ?? 587,
        smtpUser: settings.shiftReportSmtpUser ?? '',
        smtpPass: settings.shiftReportSmtpPass ?? '',
        attachments,
      })
      return result
    },
    getCameraMonthlyEmailStatus: async () => ({ sent: false }),
    sendCameraMonthlyEmail: async () => ({
      ok: false,
      error: 'use_manual_attachments',
    }),
    onUpdateAvailable: () => noopUnsub(),
    onUpdateProgress: () => noopUnsub(),
    onUpdateDownloaded: () => noopUnsub(),
    onUpdateError: () => noopUnsub(),
  }

  ;(window as Window & { __listeWebBridge?: boolean }).__listeWebBridge = true
  window.listeApi = api
}
