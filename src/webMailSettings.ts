import type { AppData, AppSettings } from './types'
import { isElectronApp } from './webDataFolder'

/** Retire SMTP / Cloudflare / Client ID OAuth du JSON et de l’état (web only). */
export function scrubObsoleteWebMailSettings<T extends { settings?: AppSettings }>(
  data: T,
): T {
  if (isElectronApp()) return data
  if (!data.settings) return data
  const settings: AppSettings = { ...data.settings }
  let changed = false
  const clear = (key: keyof AppSettings) => {
    if (key in settings && settings[key] !== undefined) {
      delete settings[key]
      changed = true
    }
  }
  clear('shiftReportSmtpHost')
  clear('shiftReportSmtpPort')
  clear('shiftReportSmtpUser')
  clear('shiftReportSmtpPass')
  clear('cloudflareRelayUrl')
  clear('cloudflareRelayKey')
  clear('googleClientId')
  if (!changed) return data
  return { ...data, settings }
}

export function scrubObsoleteWebMailAppData(data: AppData): AppData {
  return scrubObsoleteWebMailSettings(data)
}
