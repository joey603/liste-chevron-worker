import {
  mergeShiftIntoMain,
  SHIFT_REPORT_LOCAL_STORAGE_KEY,
} from './shiftReportLocalStore'
import {
  normalizeData,
  type AppSettings,
  type TelegramSendResult,
} from './types'
import { isElectronApp } from './webDataFolder'

const DATA_KEY = 'liste-chevron-data'

export const DEFAULT_CLOUDFLARE_RELAY_URL =
  'https://weathered-cell-7a63.yoelibarthel603.workers.dev'

const BIDI_MARKS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g

function sanitizeRelayText(value: string): string {
  return value.replace(BIDI_MARKS, '').trim()
}

function readSettings(): AppSettings {
  try {
    const mainRaw = JSON.parse(localStorage.getItem(DATA_KEY) ?? 'null')
    const localRaw = JSON.parse(
      localStorage.getItem(SHIFT_REPORT_LOCAL_STORAGE_KEY) ?? 'null',
    )
    const merged = mergeShiftIntoMain(mainRaw ?? {}, localRaw ?? {})
    return normalizeData(merged).settings
  } catch {
    return normalizeData(null).settings
  }
}

function relayConfig(settings?: AppSettings) {
  const s = settings ?? readSettings()
  return {
    url: DEFAULT_CLOUDFLARE_RELAY_URL,
    key: sanitizeRelayText(s.cloudflareRelayKey ?? ''),
    token: sanitizeRelayText(s.telegramBotToken ?? ''),
    chatId: sanitizeRelayText(s.telegramChatId ?? ''),
    emergencyChatId: sanitizeRelayText(s.telegramEmergencyChatId ?? ''),
  }
}

function splitTelegram(message: string): string[] {
  const chunks: string[] = []
  let rest = message
  while (rest.length > 4000) {
    let cut = rest.lastIndexOf('\n', 4000)
    if (cut < 1000) cut = 4000
    chunks.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^\n+/, '')
  }
  if (rest) chunks.push(rest)
  return chunks
}

/** Comme Electron : GET direct vers Telegram, sans Worker (réseau bureau). */
async function sendTelegramDirect(
  token: string,
  chatId: string,
  text: string,
): Promise<TelegramSendResult> {
  if (!token.trim() || !chatId.trim() || !text.trim()) {
    return { ok: false, error: 'telegram_not_configured' }
  }
  for (const chunk of splitTelegram(text)) {
    const url = `https://api.telegram.org/bot${token}/sendMessage?${new URLSearchParams({
      chat_id: chatId,
      text: chunk,
    }).toString()}`
    try {
      await fetch(url, { method: 'GET', mode: 'no-cors', cache: 'no-store' })
    } catch {
      return { ok: false, error: 'offline' }
    }
  }
  return { ok: true }
}

export function describeRelaySettings(settings?: AppSettings): string {
  const { url, key, token, chatId, emergencyChatId } = relayConfig(settings)
  return [
    `Worker: ${url}`,
    `מפתח: ${key ? `${key.length} תווים` : 'חסר'}`,
    `Token: ${token ? 'כן' : 'חסר'}`,
    `chat חירום: ${emergencyChatId || 'חסר'}`,
    `chat קבוצה: ${chatId || 'חסר'}`,
  ].join(' · ')
}

async function relayPost(
  path: string,
  body: Record<string, unknown>,
  settings?: AppSettings,
  timeoutMs = 15000,
): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  const { url, key } = relayConfig(settings)
  if (!url || !key.trim()) {
    return { ok: false, error: 'relay_not_configured' }
  }
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${url}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Relay-Key': key,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean
      error?: string
      messageId?: string
    } | null
    if (!data) return { ok: false, error: 'relay_failed' }
    if (!data.ok) {
      const err = data.error || (res.status === 401 ? 'unauthorized' : 'relay_failed')
      return {
        ok: false,
        error: res.status === 401 ? 'unauthorized' : err,
      }
    }
    return { ok: true, messageId: data.messageId }
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (
      (err instanceof DOMException && err.name === 'AbortError') ||
      /failed to fetch|networkerror|load failed|abort/i.test(msg)
    ) {
      return { ok: false, error: 'relay_blocked' }
    }
    return { ok: false, error: 'offline' }
  } finally {
    window.clearTimeout(timer)
  }
}

function encodeMimeHeader(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) return value
  const utf8 = encodeURIComponent(value).replace(/%([0-9A-F]{2})/g, (_, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  )
  return `=?UTF-8?B?${btoa(utf8)}?=`
}

function bytesToBase64(bytes: number[]): string {
  const chunk = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunk))
  }
  return btoa(binary)
}

function buildEml(payload: {
  to: string
  subject: string
  text: string
  attachments: Array<{ name: string; bytes: number[] }>
}): string {
  const boundary = `chevron${Date.now().toString(16)}`
  const lines = [
    'X-Unsent: 1',
    `To: ${payload.to}`,
    `Subject: ${encodeMimeHeader(payload.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    payload.text,
  ]
  for (const att of payload.attachments) {
    const name = String(att.name || 'file.bin').replace(/[\r\n"]/g, '')
    const wrapped = bytesToBase64(att.bytes).replace(/(.{76})/g, '$1\r\n')
    lines.push(
      `--${boundary}`,
      `Content-Type: application/octet-stream; name="${name}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${name}"`,
      '',
      wrapped,
    )
  }
  lines.push(`--${boundary}--`, '')
  return lines.join('\r\n')
}

function openOutlookDraft(payload: {
  to: string
  subject: string
  text: string
  attachments?: Array<{ name: string; bytes: number[] }>
}): void {
  const attachments = payload.attachments ?? []
  if (attachments.length === 0) {
    const url = `mailto:${payload.to}?subject=${encodeURIComponent(payload.subject)}&body=${encodeURIComponent(payload.text)}`
    window.open(url, '_self')
    return
  }
  const eml = buildEml({ ...payload, attachments })
  const blob = new Blob([eml], { type: 'message/rfc822' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${payload.subject.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80) || 'liste-chevron'}.eml`
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

async function sendEmailBrowser(payload: {
  to: string
  subject: string
  text: string
  attachments?: Array<{ name: string; bytes: number[] }>
  smtpHost?: string
  smtpPort?: number
  smtpUser?: string
  smtpPass?: string
  directorEmail?: string
}): Promise<{ ok: boolean; error?: string; messageId?: string; via?: 'worker' | 'outlook' }> {
  if (!payload.to.trim()) return { ok: false, error: 'missing_config' }
  openOutlookDraft({
    to: payload.to,
    subject: payload.subject,
    text: payload.text,
    attachments: payload.attachments,
  })
  return { ok: true, via: 'outlook' }
}

export async function sendTelegramText(
  text: string,
  chatId?: string,
  settingsOverride?: AppSettings,
): Promise<TelegramSendResult> {
  if (isElectronApp() && window.listeApi?.sendTelegramText) {
    return window.listeApi.sendTelegramText(text, chatId)
  }
  const settings = settingsOverride ?? readSettings()
  const { token, chatId: groupId } = relayConfig(settings)
  const target = (chatId ?? groupId).trim()
  if (!token || !target) return { ok: false, error: 'telegram_not_configured' }
  return sendTelegramDirect(token, target, text)
}

export async function sendTelegramPhoto(
  imageDataUrl: string,
  caption?: string,
  chatId?: string,
  settingsOverride?: AppSettings,
): Promise<TelegramSendResult> {
  if (isElectronApp() && window.listeApi?.sendTelegramPhoto) {
    return window.listeApi.sendTelegramPhoto(imageDataUrl, caption, chatId)
  }
  const settings = settingsOverride ?? readSettings()
  const { token, chatId: groupId } = relayConfig(settings)
  const target = (chatId ?? groupId).trim()
  return relayPost(
    '/telegram/photo',
    { token, chatId: target, imageDataUrl, caption: caption ?? '' },
    settings,
  )
}

export async function testTelegram(
  settingsOverride?: AppSettings,
): Promise<TelegramSendResult & { chatId?: string }> {
  if (isElectronApp() && window.listeApi?.testTelegram) {
    return window.listeApi.testTelegram()
  }
  const settings = settingsOverride ?? readSettings()
  const { chatId } = relayConfig(settings)
  const sent = await sendTelegramText(
    'בדיקת Telegram — Liste Chevron',
    chatId,
    settings,
  )
  return { ...sent, chatId }
}

export async function sendShiftReportTestEmail(payload: {
  directorEmail: string
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPass: string
}): Promise<{ ok: boolean; error?: string; via?: 'worker' | 'outlook' }> {
  if (isElectronApp() && window.listeApi?.sendShiftReportTestEmail) {
    return window.listeApi.sendShiftReportTestEmail(payload)
  }
  return sendEmailBrowser({
    ...payload,
    to: payload.directorEmail,
    subject: 'בדיקת דוא״ל — דוח משמרת',
    text:
      'זוהי הודעת בדיקה מ־Liste Chevron.\n' +
      'אם קיבלתם אותה, הגדרות הדוא״ל תקינות.',
    attachments: [],
  })
}

export async function sendShiftReportsEmail(payload: {
  date: string
  directorEmail: string
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPass: string
  attachments: Array<{ name: string; bytes: number[] }>
}): Promise<{
  ok: boolean
  messageId?: string
  error?: string
  via?: 'worker' | 'outlook'
}> {
  if (isElectronApp() && window.listeApi?.sendShiftReportsEmail) {
    return window.listeApi.sendShiftReportsEmail(payload)
  }
  return sendEmailBrowser({
    ...payload,
    to: payload.directorEmail,
    subject: `דוחות משמרת ${payload.date}`,
    text: `מצורפים דוחות המשמרת ליום ${payload.date} (בוקר, צוהריים, לילה).`,
  })
}
