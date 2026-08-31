import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { normalizeShiftReportDateKey } from './shiftReportPaths'

export type EmailSentEntry = {
  sentAt: string
  messageId?: string
  to: string
}

export type EmailSentLog = {
  shift: Record<string, EmailSentEntry>
  cameraMonthly: Record<string, EmailSentEntry>
}

export type EmailSentStatus = {
  sent: boolean
  sentAt?: string
  messageId?: string
  to?: string
}

const LOG_FILE = 'email-sent-log.json'
const LEGACY_CAMERA_FILE = 'camera-monthly-email-sent.json'

function logPath(): string {
  return path.join(app.getPath('userData'), LOG_FILE)
}

function legacyCameraPath(): string {
  return path.join(app.getPath('userData'), LEGACY_CAMERA_FILE)
}

let cache: EmailSentLog | null = null

function emptyLog(): EmailSentLog {
  return { shift: {}, cameraMonthly: {} }
}

function migrateLegacy(log: EmailSentLog): EmailSentLog {
  try {
    const p = legacyCameraPath()
    if (!fs.existsSync(p)) return log
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as { lastKey?: string }
    if (typeof raw.lastKey === 'string' && !log.cameraMonthly[raw.lastKey]) {
      log.cameraMonthly[raw.lastKey] = {
        sentAt: new Date().toISOString(),
        to: '',
      }
    }
  } catch {
    /* ignore */
  }
  return log
}

function normalizeShiftLogKeys(log: EmailSentLog): EmailSentLog {
  const shift: Record<string, EmailSentEntry> = {}
  for (const [key, entry] of Object.entries(log.shift)) {
    const normalized = normalizeShiftReportDateKey(key) ?? key.trim()
    const existing = shift[normalized]
    if (
      !existing ||
      new Date(entry.sentAt).getTime() >= new Date(existing.sentAt).getTime()
    ) {
      shift[normalized] = entry
    }
  }
  return { ...log, shift }
}

function loadLog(): EmailSentLog {
  if (cache) return cache
  try {
    const p = logPath()
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as Partial<EmailSentLog>
      cache = normalizeShiftLogKeys({
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
      })
    } else {
      cache = emptyLog()
    }
  } catch {
    cache = emptyLog()
  }
  cache = migrateLegacy(cache)
  return cache
}

function persistLog(): void {
  const log = loadLog()
  try {
    fs.writeFileSync(logPath(), JSON.stringify(log, null, 2), 'utf-8')
  } catch {
    /* ignore */
  }
}

export function getShiftEmailSent(dateKey: string): EmailSentEntry | null {
  const normalized = normalizeShiftReportDateKey(dateKey) ?? dateKey.trim()
  return loadLog().shift[normalized] ?? null
}

export function isShiftReportEmailAlreadySent(dateKey: string): boolean {
  return getShiftEmailSent(dateKey) != null
}

export function getCameraMonthlyEmailSent(monthKey: string): EmailSentEntry | null {
  return loadLog().cameraMonthly[monthKey] ?? null
}

export function recordShiftEmailSent(
  dateKey: string,
  entry: EmailSentEntry,
): void {
  const normalized = normalizeShiftReportDateKey(dateKey) ?? dateKey.trim()
  loadLog().shift[normalized] = entry
  persistLog()
}

export function recordCameraMonthlyEmailSent(
  monthKey: string,
  entry: EmailSentEntry,
): void {
  loadLog().cameraMonthly[monthKey] = entry
  persistLog()
}

export function shiftEmailStatus(dateKey: string): EmailSentStatus {
  const entry = getShiftEmailSent(dateKey)
  if (!entry) return { sent: false }
  return {
    sent: true,
    sentAt: entry.sentAt,
    messageId: entry.messageId,
    to: entry.to,
  }
}

export function cameraMonthlyEmailStatus(monthKey: string): EmailSentStatus {
  const entry = getCameraMonthlyEmailSent(monthKey)
  if (!entry) return { sent: false }
  return {
    sent: true,
    sentAt: entry.sentAt,
    messageId: entry.messageId,
    to: entry.to,
  }
}

export type ShiftEmailSentLogItem = {
  date: string
  sentAt: string
  messageId?: string
  to: string
}

function shiftDateSortKey(dateKey: string): number {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(dateKey.trim())
  if (!m) return 0
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime()
}

export function listShiftEmailSentLog(): ShiftEmailSentLogItem[] {
  const log = loadLog()
  return Object.entries(log.shift)
    .map(([date, entry]) => ({
      date,
      sentAt: entry.sentAt,
      messageId: entry.messageId,
      to: entry.to,
    }))
    .sort((a, b) => shiftDateSortKey(b.date) - shiftDateSortKey(a.date))
}
