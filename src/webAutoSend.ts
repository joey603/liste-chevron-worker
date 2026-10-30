import {
  getPreviousCalendarMonth,
  monthlyCameraReportKey,
} from './cameraReportMonthly'
import { hasGmailToken } from './gmailSend'
import { formatShiftDate } from './shiftReport'
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
