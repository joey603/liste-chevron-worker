import { parseShiftReportDate } from './shiftReportPaths'

export type WebEmailSentEntry = {
  sentAt: string
  messageId?: string
  to: string
  /** Noms des fichiers joints (דוחות) au moment de l’envoi */
  attachmentNames?: string[]
}

type WebEmailSentLog = {
  shift: Record<string, WebEmailSentEntry>
  cameraMonthly: Record<string, WebEmailSentEntry>
  telegramDaily?: string | null
}

const STORAGE_KEY = 'liste-email-sent-log'

function normalizeShiftKey(dateKey: string): string {
  return parseShiftReportDate(dateKey)?.formatted ?? dateKey.trim()
}

function emptyLog(): WebEmailSentLog {
  return { shift: {}, cameraMonthly: {}, telegramDaily: null }
}

function loadLog(): WebEmailSentLog {
  try {
    const raw = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? 'null',
    ) as Partial<WebEmailSentLog> | null
    if (!raw || typeof raw !== 'object') return emptyLog()
    return {
      shift:
        raw.shift && typeof raw.shift === 'object' && !Array.isArray(raw.shift)
          ? raw.shift
          : {},
      cameraMonthly:
        raw.cameraMonthly &&
        typeof raw.cameraMonthly === 'object' &&
        !Array.isArray(raw.cameraMonthly)
          ? raw.cameraMonthly
          : {},
      telegramDaily:
        typeof raw.telegramDaily === 'string' ? raw.telegramDaily : null,
    }
  } catch {
    return emptyLog()
  }
}

function saveLog(log: WebEmailSentLog) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(log))
  } catch {
    /* ignore quota */
  }
}

export function getWebShiftEmailSent(
  dateKey: string,
): WebEmailSentEntry | null {
  const key = normalizeShiftKey(dateKey)
  return loadLog().shift[key] ?? null
}

export function recordWebShiftEmailSent(
  dateKey: string,
  entry: WebEmailSentEntry,
) {
  const log = loadLog()
  log.shift[normalizeShiftKey(dateKey)] = entry
  saveLog(log)
}

export function getWebCameraMonthlyEmailSent(
  monthKey: string,
): WebEmailSentEntry | null {
  return loadLog().cameraMonthly[monthKey] ?? null
}

export function recordWebCameraMonthlyEmailSent(
  monthKey: string,
  entry: WebEmailSentEntry,
) {
  const log = loadLog()
  log.cameraMonthly[monthKey] = entry
  saveLog(log)
}

export function getWebTelegramDailyLastSentDate(): string | null {
  return loadLog().telegramDaily ?? null
}

export function recordWebTelegramDailySent(dateKey: string) {
  const log = loadLog()
  log.telegramDaily = dateKey
  saveLog(log)
}

function shiftDateSortKey(dateKey: string): number {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(dateKey.trim())
  if (!m) return 0
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime()
}

export function listWebShiftEmailSentLog(): Array<{
  date: string
  sentAt: string
  messageId?: string
  to: string
  attachmentNames?: string[]
}> {
  const log = loadLog()
  return Object.entries(log.shift)
    .map(([date, entry]) => ({
      date,
      sentAt: entry.sentAt,
      messageId: entry.messageId,
      to: entry.to,
      attachmentNames: entry.attachmentNames,
    }))
    .sort((a, b) => shiftDateSortKey(b.date) - shiftDateSortKey(a.date))
}
