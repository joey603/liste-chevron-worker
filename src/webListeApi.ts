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
  sendCameraMonthlyReportEmail,
  sendShiftReportTestEmail,
  sendShiftReportsEmail,
  sendTelegramPhoto,
  sendTelegramText,
  testTelegram,
} from './webRelay'
import {
  buildMonthlyCameraReport,
  cameraReportMonthlyRelativeDir,
  cameraReportMonthlyWorkbookFileName,
  monthlyCameraReportHasContent,
  monthlyCameraReportKey,
} from './cameraReportMonthly'
import { hebrewMonthName } from './shiftReportPaths'
import {
  getWebCameraMonthlyEmailSent,
  getWebShiftEmailSent,
  listWebShiftEmailSentLog,
  recordWebCameraMonthlyEmailSent,
  recordWebShiftEmailSent,
} from './webEmailSentLog'

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
    getShiftReportEmailStatus: async (payload) => {
      const entry = getWebShiftEmailSent(payload.date)
      if (!entry) return { sent: false }
      return {
        sent: true,
        sentAt: entry.sentAt,
        messageId: entry.messageId,
        to: entry.to,
      }
    },
    getShiftReportEmailSentLog: async () => listWebShiftEmailSentLog(),
    sendShiftReportEmail: async (payload) => {
      const existing = getWebShiftEmailSent(payload.date)
      if (existing && !payload.force) {
        return {
          ok: false,
          alreadySent: true,
          sentAt: existing.sentAt,
          messageId: existing.messageId,
          to: existing.to,
        }
      }
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
      if (result.ok) {
        const sentAt = new Date().toISOString()
        recordWebShiftEmailSent(payload.date, {
          sentAt,
          messageId: result.messageId,
          to,
          attachmentNames: attachments.map((a) => a.name),
        })
        return { ...result, sentAt, to }
      }
      return result
    },
    getCameraMonthlyEmailStatus: async (payload) => {
      const monthKey = monthlyCameraReportKey(payload.year, payload.month)
      const entry = getWebCameraMonthlyEmailSent(monthKey)
      if (!entry) return { sent: false }
      return {
        sent: true,
        sentAt: entry.sentAt,
        messageId: entry.messageId,
        to: entry.to,
      }
    },
    sendCameraMonthlyEmail: async (payload) => {
      const monthKey = monthlyCameraReportKey(payload.year, payload.month)
      const existing = getWebCameraMonthlyEmailSent(monthKey)
      if (existing && !payload.force) {
        return {
          ok: false,
          alreadySent: true,
          sentAt: existing.sentAt,
          messageId: existing.messageId,
          to: existing.to,
        }
      }
      let data
      try {
        const main = JSON.parse(
          localStorage.getItem('liste-chevron-data') ?? 'null',
        )
        const local = JSON.parse(
          localStorage.getItem(SHIFT_REPORT_LOCAL_STORAGE_KEY) ?? 'null',
        )
        data = normalizeData(
          mergeShiftIntoMain((main as object) ?? {}, (local as object) ?? {}),
        )
      } catch {
        return { ok: false, error: 'missing_config' }
      }
      const to = data.settings.directorEmail?.trim() ?? ''
      if (!to) return { ok: false, error: 'missing_config' }
      const monthly = buildMonthlyCameraReport(
        data.cameraReportsArchive,
        payload.year,
        payload.month,
      )
      if (!monthlyCameraReportHasContent(monthly)) {
        return { ok: false, error: 'no_workbook' }
      }
      const folder =
        data.settings.cameraReportSaveFolder?.trim() ||
        data.settings.shiftReportSaveFolder?.trim() ||
        WEB_FOLDER_CAMERAS
      const fileName = cameraReportMonthlyWorkbookFileName(
        payload.year,
        payload.month,
      )
      const relativeDir = cameraReportMonthlyRelativeDir(
        payload.year,
        payload.month,
      )
      let bytes: Uint8Array | null = null
      const dir = await resolveWebDir(folder, relativeDir, false, 'camera')
      if (dir) bytes = await readBytesFile(dir, fileName)
      if (!bytes?.length) {
        try {
          const { buildCameraMonthlyWorkbookBuffer } = await import(
            '../electron/cameraReportWorkbook'
          )
          const buf = await buildCameraMonthlyWorkbookBuffer({
            year: payload.year,
            month: payload.month,
            archive: data.cameraReportsArchive,
            currentReport: data.cameraReport,
          })
          bytes = new Uint8Array(buf)
        } catch {
          return { ok: false, error: 'workbook_build_failed' }
        }
      }
      const result = await sendCameraMonthlyReportEmail({
        hebrewMonth: hebrewMonthName(payload.month),
        year: payload.year,
        directorEmail: to,
        attachmentName: fileName,
        attachmentBytes: Array.from(bytes),
      })
      if (result.ok) {
        const sentAt = new Date().toISOString()
        recordWebCameraMonthlyEmailSent(monthKey, {
          sentAt,
          messageId: result.messageId,
          to,
        })
        return { ...result, sentAt, to }
      }
      return result
    },
    onUpdateAvailable: () => noopUnsub(),
    onUpdateProgress: () => noopUnsub(),
    onUpdateDownloaded: () => noopUnsub(),
    onUpdateError: () => noopUnsub(),
  }

  ;(window as Window & { __listeWebBridge?: boolean }).__listeWebBridge = true
  window.listeApi = api
}
