/** Données sensibles / modifiables du דוח משמרת — stockées hors liste-data.json. */
export type ShiftReportLocalSettings = {
  shiftReportSaveFolder?: string
  directorEmail?: string
  shiftReportEmailTime?: string
  shiftReportSmtpHost?: string
  shiftReportSmtpPort?: number
  shiftReportSmtpUser?: string
  shiftReportSmtpPass?: string
}

export type ShiftReportLocalPayload = {
  shiftReport?: unknown
  shiftReportTexts?: unknown
  shiftReportsArchive?: Record<string, unknown>
  settings?: ShiftReportLocalSettings
}

type AppDataLike = {
  shiftReport?: unknown
  shiftReportTexts?: unknown
  shiftReportsArchive?: Record<string, unknown>
  settings?: ShiftReportLocalSettings & Record<string, unknown>
}

export function extractShiftLocalPayload(source: AppDataLike): ShiftReportLocalPayload {
  const settings = source.settings
  return {
    shiftReport: source.shiftReport,
    shiftReportTexts: source.shiftReportTexts,
    shiftReportsArchive: source.shiftReportsArchive,
    settings: settings
      ? {
          shiftReportSaveFolder: settings.shiftReportSaveFolder,
          directorEmail: settings.directorEmail,
          shiftReportEmailTime: settings.shiftReportEmailTime,
          shiftReportSmtpHost: settings.shiftReportSmtpHost,
          shiftReportSmtpPort: settings.shiftReportSmtpPort,
          shiftReportSmtpUser: settings.shiftReportSmtpUser,
          shiftReportSmtpPass: settings.shiftReportSmtpPass,
        }
      : undefined,
  }
}

export function hasShiftLocalContent(payload: ShiftReportLocalPayload): boolean {
  if (payload.shiftReport != null) return true
  if (payload.shiftReportTexts != null) return true
  if (
    payload.shiftReportsArchive &&
    Object.keys(payload.shiftReportsArchive).length > 0
  ) {
    return true
  }
  const s = payload.settings
  if (!s) return false
  return Boolean(
    s.shiftReportSaveFolder?.trim() ||
      s.directorEmail?.trim() ||
      s.shiftReportSmtpHost?.trim() ||
      s.shiftReportSmtpUser?.trim() ||
      s.shiftReportSmtpPass,
  )
}

export function stripShiftFromMain<T extends AppDataLike>(raw: T): T {
  const next = { ...raw }
  delete next.shiftReport
  delete next.shiftReportTexts
  delete next.shiftReportsArchive
  if (next.settings) {
    const settings = { ...next.settings }
    delete settings.shiftReportSaveFolder
    delete settings.directorEmail
    delete settings.shiftReportEmailTime
    delete settings.shiftReportSmtpHost
    delete settings.shiftReportSmtpPort
    delete settings.shiftReportSmtpUser
    delete settings.shiftReportSmtpPass
    next.settings = settings
  }
  return next
}

export function mergeShiftIntoMain<T extends AppDataLike>(
  raw: T,
  local: ShiftReportLocalPayload,
): T {
  const next: AppDataLike = { ...raw }
  if (local.shiftReport !== undefined) next.shiftReport = local.shiftReport
  if (local.shiftReportTexts !== undefined) {
    next.shiftReportTexts = local.shiftReportTexts
  }
  if (local.shiftReportsArchive !== undefined) {
    next.shiftReportsArchive = local.shiftReportsArchive
  }
  if (local.settings) {
    next.settings = {
      ...next.settings,
      ...local.settings,
    }
  }
  return next as T
}

export function hasLegacyShiftInMain(raw: AppDataLike): boolean {
  return Boolean(
    raw.shiftReport != null ||
      raw.shiftReportTexts != null ||
      (raw.shiftReportsArchive &&
        typeof raw.shiftReportsArchive === 'object' &&
        Object.keys(raw.shiftReportsArchive).length > 0) ||
      raw.settings?.shiftReportSaveFolder ||
      raw.settings?.directorEmail ||
      raw.settings?.shiftReportSmtpHost ||
      raw.settings?.shiftReportSmtpUser ||
      raw.settings?.shiftReportSmtpPass,
  )
}

export const SHIFT_REPORT_LOCAL_STORAGE_KEY = 'liste-chevron-shift-local'
