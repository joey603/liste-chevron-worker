import {
  deleteFileIfExists,
  getStoredDataFolder,
  isElectronApp,
  isWebFolderSupported,
  isWebFolderToken,
  resolveWebDir,
  WEB_FOLDER_CAMERAS,
  WEB_FOLDER_ROOT,
  WEB_FOLDER_SHIFTS,
  writeBytesFile,
} from './webDataFolder'
import {
  buildCameraMonthlyJsonBytes,
  cameraMonthlyJsonFileName,
} from './cameraReportWorkbookBrowser'
import type { ListeApi } from './types'
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
    pickFolder: async () => {
      const root = await getStoredDataFolder()
      if (!root) return { ok: false, canceled: true }
      return { ok: true, path: WEB_FOLDER_SHIFTS }
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
      const folder = isWebFolderToken(payload.folder)
        ? payload.folder
        : WEB_FOLDER_SHIFTS
      const dir = await resolveWebDir(folder, payload.relativeDir, true)
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
      const folder = isWebFolderToken(payload.folder)
        ? payload.folder
        : WEB_FOLDER_SHIFTS
      const dir = await resolveWebDir(folder, payload.relativeDir, false)
      if (!dir) return { ok: true }
      await deleteFileIfExists(dir, payload.docxFileName)
      await deleteFileIfExists(dir, payload.jsonFileName)
      return { ok: true }
    },
    saveCameraReportWorkbook: async (payload) => {
      const folder = isWebFolderToken(payload.folder)
        ? payload.folder
        : WEB_FOLDER_CAMERAS
      const dir = await resolveWebDir(folder, payload.relativeDir, true)
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
    sendShiftReportEmail: async () => ({
      ok: false,
      error: 'use_manual_attachments',
    }),
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
