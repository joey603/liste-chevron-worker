import {
  getPreviousCalendarMonth,
  monthlyCameraReportKey,
} from './cameraReportMonthly'
import { hasGmailToken } from './gmailSend'
import { formatShiftDate } from './shiftReport'
import { parseShiftReportDate, shiftDateToDate } from './shiftReportPaths'
import {
  buildPresenceListMessage,
  hasTelegramWatch,
  type AppData,
} from './types'
import { isElectronApp } from './webDataFolder'
import {
  getWebCameraMonthlyEmailSent,
  getWebShiftEmailSent,
  getWebTelegramDailyLastSentDate,
  recordWebTelegramDailySent,
} from './webEmailSentLog'
import { sendTelegramText } from './webRelay'

export type WebAutoSendHandlers = {
  getData: () => AppData | null
  onToast?: (message: string) => void
  /** Gmail déconnecté à l’heure d’envoi — ouvrir la bannière / le bouton */
  onNeedGmail?: () => void
}

function parseTimeToMinutes(raw: string): number | null {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const hours = Number(m[1])
  const mins = Number(m[2])
  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(mins) ||
    hours < 0 ||
    hours > 23 ||
    mins < 0 ||
    mins > 59
  ) {
    return null
  }
  return hours * 60 + mins
}

/** Après l’heure prévue (pas seulement la minute exacte). */
export function hasReachedScheduledTime(now: Date, targetTime: string): boolean {
  const target = parseTimeToMinutes(targetTime) ?? parseTimeToMinutes('07:00')
  if (target == null) return false
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  return nowMinutes >= target
}

/** Date du rapport envoyé à l’heure auto (veille du jour calendaire). */
export function shiftAutoSendReportDateKey(now = new Date()): string {
  const reportDay = new Date(now)
  reportDay.setDate(reportDay.getDate() - 1)
  return formatShiftDate(reportDay)
}

/**
 * Moment d’envoi auto pour un rapport daté `reportDate` :
 * le lendemain à l’heure réglée (ex. 30 → 31 à 07:00).
 */
export function shiftAutoSendScheduledAt(
  reportDate: string,
  targetTime: string,
): Date | null {
  const parsed = parseShiftReportDate(reportDate)
  if (!parsed) return null
  const target = parseTimeToMinutes(targetTime) ?? parseTimeToMinutes('07:00')
  if (target == null) return null
  const sendDay = shiftDateToDate(parsed.formatted)
  sendDay.setDate(sendDay.getDate() + 1)
  sendDay.setHours(Math.floor(target / 60), target % 60, 0, 0)
  return sendDay
}

export function msUntilScheduledTime(now: Date, targetTime: string): number {
  const target = parseTimeToMinutes(targetTime) ?? parseTimeToMinutes('07:00')
  if (target == null) return 0
  const scheduled = new Date(now)
  scheduled.setHours(Math.floor(target / 60), target % 60, 0, 0)
  return Math.max(0, scheduled.getTime() - now.getTime())
}

export function formatRemainingHebrew(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const days = Math.floor(totalSec / 86400)
  const hours = Math.floor((totalSec % 86400) / 3600)
  const mins = Math.floor((totalSec % 3600) / 60)
  const secs = totalSec % 60
  if (days > 0) {
    return hours > 0 ? `${days} ימ׳ ${hours} שע׳` : `${days} ימ׳`
  }
  if (hours > 0) {
    return mins > 0 ? `${hours} שע׳ ${mins} דק׳` : `${hours} שע׳`
  }
  if (mins > 0) {
    return secs > 0 && mins < 5 ? `${mins} דק׳ ${secs} שנ׳` : `${mins} דק׳`
  }
  return `${secs} שנ׳`
}

export type ShiftAutoSendBadgeState =
  | { kind: 'hidden' }
  | { kind: 'waiting'; label: string; targetTime: string }
  | { kind: 'sent'; label: string; targetTime: string }
  | { kind: 'missed'; label: string; targetTime: string }

export function buildShiftAutoSendBadgeState(options: {
  mode?: string | null
  targetTime?: string | null
  /** Date du דוח affiché (DD.MM.YYYY) — envoi le lendemain */
  reportDate: string
  sent: boolean
  now?: Date
}): ShiftAutoSendBadgeState {
  if ((options.mode ?? 'auto') === 'manual') return { kind: 'hidden' }
  const targetTime = options.targetTime?.trim() || '07:00'
  const now = options.now ?? new Date()
  const scheduledAt = shiftAutoSendScheduledAt(options.reportDate, targetTime)
  if (!scheduledAt) return { kind: 'hidden' }

  if (now.getTime() < scheduledAt.getTime()) {
    const remaining = formatRemainingHebrew(
      scheduledAt.getTime() - now.getTime(),
    )
    return {
      kind: 'waiting',
      targetTime,
      label: `יישלח בעוד ${remaining}`,
    }
  }
  if (options.sent) {
    return { kind: 'sent', targetTime, label: 'נשלח' }
  }
  return { kind: 'missed', targetTime, label: 'לא נשלח' }
}

function localCalendarDateKey(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

const GMAIL_MISS_PREFIX = 'liste-gmail-miss-notified:'

function notifyGmailMissOnce(
  kind: string,
  dayKey: string,
  handlers: WebAutoSendHandlers,
) {
  const key = `${GMAIL_MISS_PREFIX}${kind}:${dayKey}`
  try {
    if (sessionStorage.getItem(key) === '1') return
    sessionStorage.setItem(key, '1')
  } catch {
    /* ignore */
  }
  handlers.onToast?.(
    'Gmail מנותק — השליחה האוטומטית לא יצאה. התחברו ל־Gmail.',
  )
  handlers.onNeedGmail?.()
}

let shiftInFlight = false
let cameraInFlight = false
let telegramInFlight = false

async function trySendDailyShiftReports(handlers: WebAutoSendHandlers) {
  if (shiftInFlight) return
  const data = handlers.getData()
  if (!data) return
  const settings = data.settings
  if ((settings.shiftReportEmailMode ?? 'auto') === 'manual') return

  const email = settings.directorEmail?.trim()
  const clientId = settings.googleClientId?.trim()
  if (!email || !clientId) return
  if (!window.listeApi?.sendShiftReportEmail) return

  const now = new Date()
  const targetTime = settings.shiftReportEmailTime?.trim() || '07:00'
  if (!hasReachedScheduledTime(now, targetTime)) return

  const reportDay = new Date(now)
  reportDay.setDate(reportDay.getDate() - 1)
  const dateKey = formatShiftDate(reportDay)
  if (getWebShiftEmailSent(dateKey)) return

  if (!hasGmailToken()) {
    notifyGmailMissOnce('shift', localCalendarDateKey(now), handlers)
    return
  }

  shiftInFlight = true
  try {
    const result = await window.listeApi.sendShiftReportEmail({ date: dateKey })
    if (result.alreadySent) return
    if (result.ok) {
      handlers.onToast?.(`דוחות משמרת נשלחו אוטומטית (${dateKey})`)
      return
    }
    if (
      result.error === 'gmail_denied' ||
      result.error === 'gmail_client_missing'
    ) {
      notifyGmailMissOnce('shift', localCalendarDateKey(now), handlers)
      return
    }
    // no_attachments / no_report_data : pas de toast chaque minute
    if (
      result.error &&
      result.error !== 'no_attachments' &&
      result.error !== 'no_report_data'
    ) {
      console.warn('[web-shift-email-auto]', dateKey, result.error)
    }
  } catch (err) {
    console.warn('[web-shift-email-auto]', dateKey, err)
  } finally {
    shiftInFlight = false
  }
}

async function trySendMonthlyCameraReports(handlers: WebAutoSendHandlers) {
  if (cameraInFlight) return
  const data = handlers.getData()
  if (!data) return
  const settings = data.settings
  if ((settings.cameraReportEmailMode ?? 'auto') === 'manual') return

  const email = settings.directorEmail?.trim()
  const clientId = settings.googleClientId?.trim()
  if (!email || !clientId) return
  if (!window.listeApi?.sendCameraMonthlyEmail) return

  const now = new Date()
  if (now.getDate() !== 1) return

  const targetTime =
    settings.cameraReportEmailTime?.trim() ||
    settings.shiftReportEmailTime?.trim() ||
    '07:00'
  if (!hasReachedScheduledTime(now, targetTime)) return

  const { month, year } = getPreviousCalendarMonth(now)
  const monthKey = monthlyCameraReportKey(year, month)
  if (getWebCameraMonthlyEmailSent(monthKey)) return

  if (!hasGmailToken()) {
    notifyGmailMissOnce('camera', monthKey, handlers)
    return
  }

  cameraInFlight = true
  try {
    const result = await window.listeApi.sendCameraMonthlyEmail({ year, month })
    if (result.alreadySent) return
    if (result.ok) {
      handlers.onToast?.(`יומן מצלמות נשלח אוטומטית (${monthKey})`)
      return
    }
    if (
      result.error === 'gmail_denied' ||
      result.error === 'gmail_client_missing'
    ) {
      notifyGmailMissOnce('camera', monthKey, handlers)
      return
    }
    if (
      result.error &&
      result.error !== 'no_workbook' &&
      result.error !== 'workbook_build_failed'
    ) {
      console.warn('[web-camera-email-auto]', monthKey, result.error)
    }
  } catch (err) {
    console.warn('[web-camera-email-auto]', monthKey, err)
  } finally {
    cameraInFlight = false
  }
}

async function trySendDailyTelegramList(handlers: WebAutoSendHandlers) {
  if (telegramInFlight) return
  const data = handlers.getData()
  if (!data) return
  if (!data.settings.telegramDailyListEnabled) return
  if (!hasTelegramWatch(data)) return

  const now = new Date()
  const targetTime = data.settings.telegramDailyListTime?.trim() || '07:00'
  if (!hasReachedScheduledTime(now, targetTime)) return

  const dateKey = localCalendarDateKey(now)
  if (getWebTelegramDailyLastSentDate() === dateKey) return

  telegramInFlight = true
  try {
    const text = buildPresenceListMessage(data).replace(
      'רשימה מ־',
      'רשימה אוטומטית מ־',
    )
    const result = await sendTelegramText(text, undefined, data.settings)
    if (result.ok) {
      recordWebTelegramDailySent(dateKey)
      handlers.onToast?.('רשימת הנוכחים נשלחה אוטומטית ל־Telegram')
    } else {
      console.warn('[web-telegram-daily]', dateKey, result.error)
    }
  } catch (err) {
    console.warn('[web-telegram-daily]', dateKey, err)
  } finally {
    telegramInFlight = false
  }
}

export function tickWebAutoSend(handlers: WebAutoSendHandlers) {
  if (isElectronApp()) return
  if (document.visibilityState === 'hidden') return
  void trySendDailyShiftReports(handlers)
  void trySendMonthlyCameraReports(handlers)
  void trySendDailyTelegramList(handlers)
}

/** Démarre le poll 60s (comme Electron). Retourne une fonction stop. */
export function startWebAutoSend(handlers: WebAutoSendHandlers): () => void {
  if (isElectronApp()) return () => {}
  const run = () => tickWebAutoSend(handlers)
  run()
  const id = window.setInterval(run, 60_000)
  const onVisible = () => {
    if (document.visibilityState === 'visible') run()
  }
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    window.clearInterval(id)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
