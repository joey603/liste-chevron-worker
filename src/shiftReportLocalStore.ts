/** Données sensibles / modifiables du דוח משמרת — stockées hors liste-data.json. */
export type ShiftReportLocalSettings = {
  shiftReportSaveFolder?: string
  cameraReportSaveFolder?: string
  directorEmail?: string
  shiftReportEmailTime?: string
  shiftReportEmailMode?: 'auto' | 'manual'
  cameraReportEmailTime?: string
  cameraReportEmailMode?: 'auto' | 'manual'
  shiftReportSmtpHost?: string
  shiftReportSmtpPort?: number
  shiftReportSmtpUser?: string
  shiftReportSmtpPass?: string
}

export type ShiftReportLocalPayload = {
  shiftReport?: unknown
  shiftReportTexts?: unknown
  shiftReportsArchive?: Record<string, unknown>
  cameraReport?: unknown
  cameraReportsArchive?: Record<string, unknown>
  settings?: ShiftReportLocalSettings
}

type AppDataLike = {
  shiftReport?: unknown
  shiftReportTexts?: unknown
  shiftReportsArchive?: Record<string, unknown>
  cameraReport?: unknown
  cameraReportsArchive?: Record<string, unknown>
  settings?: ShiftReportLocalSettings & Record<string, unknown>
}

const SETTINGS_KEYS = [
  'shiftReportSaveFolder',
  'cameraReportSaveFolder',
  'directorEmail',
  'shiftReportEmailTime',
  'shiftReportEmailMode',
  'cameraReportEmailTime',
  'cameraReportEmailMode',
  'shiftReportSmtpHost',
  'shiftReportSmtpPort',
  'shiftReportSmtpUser',
  'shiftReportSmtpPass',
] as const satisfies ReadonlyArray<keyof ShiftReportLocalSettings>

function isFilledSettingValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'number') return Number.isFinite(value)
  return false
}

/** Fusionne les réglages : une valeur remplie n'est jamais écrasée par une valeur vide. */
export function coalesceShiftSettings(
  base?: ShiftReportLocalSettings | null,
  overlay?: ShiftReportLocalSettings | null,
): ShiftReportLocalSettings | undefined {
  if (!base && !overlay) return undefined
  const result: ShiftReportLocalSettings = { ...(base ?? {}) }
  if (!overlay) return result
  for (const key of SETTINGS_KEYS) {
    const next = overlay[key]
    const prev = result[key]
    if (isFilledSettingValue(next)) {
      ;(result as Record<string, unknown>)[key] = next
    } else if (!isFilledSettingValue(prev) && next !== undefined) {
      ;(result as Record<string, unknown>)[key] = next
    }
  }
  return result
}

function extractSettings(
  settings: AppDataLike['settings'],
): ShiftReportLocalSettings | undefined {
  if (!settings) return undefined
  return {
    shiftReportSaveFolder: settings.shiftReportSaveFolder,
    cameraReportSaveFolder: settings.cameraReportSaveFolder,
    directorEmail: settings.directorEmail,
    shiftReportEmailTime: settings.shiftReportEmailTime,
    shiftReportEmailMode: settings.shiftReportEmailMode,
    cameraReportEmailTime: settings.cameraReportEmailTime,
    cameraReportEmailMode: settings.cameraReportEmailMode,
    shiftReportSmtpHost: settings.shiftReportSmtpHost,
    shiftReportSmtpPort: settings.shiftReportSmtpPort,
    shiftReportSmtpUser: settings.shiftReportSmtpUser,
    shiftReportSmtpPass: settings.shiftReportSmtpPass,
  }
}

export function extractShiftLocalPayload(source: AppDataLike): ShiftReportLocalPayload {
  return {
    shiftReport: source.shiftReport,
    shiftReportTexts: source.shiftReportTexts,
    shiftReportsArchive: source.shiftReportsArchive,
    cameraReport: source.cameraReport,
    cameraReportsArchive: source.cameraReportsArchive,
    settings: extractSettings(source.settings),
  }
}

export function hasShiftLocalContent(payload: ShiftReportLocalPayload): boolean {
  if (payload.shiftReport != null) return true
  if (payload.shiftReportTexts != null) return true
  if (payload.cameraReport != null) return true
  if (
    payload.cameraReportsArchive &&
    Object.keys(payload.cameraReportsArchive).length > 0
  ) {
    return true
  }
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
      s.cameraReportSaveFolder?.trim() ||
      s.directorEmail?.trim() ||
      s.shiftReportSmtpHost?.trim() ||
      s.shiftReportSmtpUser?.trim() ||
      s.shiftReportSmtpPass,
  )
}

/**
 * Retire du stockage principal uniquement les rapports / textes / archives.
 * Les réglages mail + תיקיית שמירה restent dans le fichier principal.
 */
export function stripShiftFromMain<T extends AppDataLike>(raw: T): T {
  const next = { ...raw }
  delete next.shiftReport
  delete next.shiftReportTexts
  delete next.shiftReportsArchive
  delete next.cameraReport
  delete next.cameraReportsArchive
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
  if (local.cameraReport !== undefined) next.cameraReport = local.cameraReport
  if (local.cameraReportsArchive !== undefined) {
    next.cameraReportsArchive = local.cameraReportsArchive
  }
  const mergedSettings = coalesceShiftSettings(
    extractSettings(next.settings),
    local.settings,
  )
  if (mergedSettings) {
    next.settings = {
      ...next.settings,
      ...mergedSettings,
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
      raw.cameraReport != null ||
      (raw.cameraReportsArchive &&
        typeof raw.cameraReportsArchive === 'object' &&
        Object.keys(raw.cameraReportsArchive).length > 0),
  )
}

export const SHIFT_REPORT_LOCAL_STORAGE_KEY = 'liste-chevron-shift-local'
