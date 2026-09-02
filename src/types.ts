import type { ShiftReport, ShiftReportTexts } from './shiftReport'
import {
  normalizeShiftReport,
  normalizeShiftReportTexts,
} from './shiftReport'
import type { ShiftReportsArchive } from './shiftReportArchive'
import type { CameraReport } from './cameraReport'
import { normalizeCameraReport } from './cameraReport'
import type { CameraReportsArchive } from './cameraReportArchive'
import { formatShiftDate } from './shiftReport'

export type EntryKind = 'named' | 'visitor'

export type Worker = {
  id: string
  firstName: string
  lastName: string
  /** עובד זמני — הכרטיס נמחק בחצות */
  temporary: boolean
  /** תאריך/שעת תפוגה (חצות של אותו יום) */
  expiresAt: string | null
}

/** ייחודי = נחסם ברשימה בזמן שהוא באתר · מרובה = ניתן לשייך לכמה ויזיטורים */
export type CardlessAssignment = 'unique' | 'multiple'

/** שם ללא כרטיס — ממתין לשיוך ויזיטור */
export type CardlessPerson = {
  id: string
  firstName: string
  lastName: string
  /** נמחק בחצות */
  temporary: boolean
  expiresAt: string | null
  assignment: CardlessAssignment
}

export type PersonEntry = {
  id: string
  kind: EntryKind
  workerId: string | null
  /** קישור לשם ללא כרטיס (למצב ייחודי) */
  cardlessPersonId: string | null
  firstName: string
  lastName: string
  visitorNumber: number | null
  enteredAt: string
  exitedAt: string | null
}

export type VisitorAccess = 'closed' | 'open_temp' | 'open_constant'

export type VisitorSlot = {
  access: VisitorAccess
  openUntil: string | null
}

/** איש קשר לשליחת WhatsApp (חירום ו/או שיתוף) */
export type ContactPhone = {
  id: string
  name: string
  phone: string
  /** נשלח בלחיצת «חירום» */
  emergency: boolean
}

export type AppSettings = {
  directorPhone: string
  /** מספרי WhatsApp (עם שם + דגל חירום) */
  emergencyPhones: ContactPhone[]
  siteName: string
  /** מצב לכל ויזיטור 1–30 */
  visitorSlots: Record<string, VisitorSlot>
  /** תיקייה לשמירה אוטומטית של דוחות משמרת */
  shiftReportSaveFolder?: string
  /** תיקייה לשמירה אוטומטית של דוחות מצלמות */
  cameraReportSaveFolder?: string
  /** אימייל מנהל לקבלת 3 הדוחות היומיים */
  directorEmail?: string
  /** שעת שליחה יומית (HH:MM) */
  shiftReportEmailTime?: string
  /** אוטומטי או ידני — דוח משמרת */
  shiftReportEmailMode?: EmailSendMode
  /** שעת שליחה חודשית — 1 בחודש, קובץ החודש הקודם (HH:MM) */
  cameraReportEmailTime?: string
  /** אוטומטי או ידני — דוח מצלמות */
  cameraReportEmailMode?: EmailSendMode
  /** SMTP לשליחת דוחות */
  shiftReportSmtpHost?: string
  shiftReportSmtpPort?: number
  shiftReportSmtpUser?: string
  shiftReportSmtpPass?: string
}

export const VISITOR_COUNT = 30

export type EmailSendMode = 'auto' | 'manual'

export type EmailSendResult = {
  ok: boolean
  alreadySent?: boolean
  sentAt?: string
  messageId?: string
  to?: string
  error?: string
}

export type EmailSentStatus = {
  sent: boolean
  sentAt?: string
  messageId?: string
  to?: string
}

export type ShiftEmailSentLogItem = {
  date: string
  sentAt: string
  messageId?: string
  to: string
}

export function normalizeEmailSendMode(raw: unknown): EmailSendMode {
  return raw === 'manual' ? 'manual' : 'auto'
}

export function defaultVisitorSlots(): Record<string, VisitorSlot> {
  const slots: Record<string, VisitorSlot> = {}
  for (let n = 1; n <= VISITOR_COUNT; n++) {
    slots[String(n)] = { access: 'closed', openUntil: null }
  }
  return slots
}

export function normalizeVisitorSlots(
  raw: Record<string, Partial<VisitorSlot>> | null | undefined,
  now = new Date(),
): Record<string, VisitorSlot> {
  const slots = defaultVisitorSlots()
  if (raw && typeof raw === 'object') {
    for (let n = 1; n <= VISITOR_COUNT; n++) {
      const key = String(n)
      const item = raw[key]
      if (!item) continue
      let access: VisitorAccess = 'closed'
      if (
        item.access === 'open_temp' ||
        item.access === 'open_constant' ||
        item.access === 'closed'
      ) {
        access = item.access
      }
      let openUntil = item.openUntil ?? null
      if (access === 'open_temp') {
        if (!openUntil || new Date(openUntil).getTime() <= now.getTime()) {
          access = 'closed'
          openUntil = null
        }
      } else {
        openUntil = null
      }
      slots[key] = { access, openUntil }
    }
  }
  return slots
}

export type BannedPerson = {
  id: string
  firstName: string
  lastName: string
  reason: string
  /** לוחית רישוי — אופציונלי */
  plateNumber: string
  /** תעודת זהות — אופציונלי */
  idNumber: string
  addedAt: string
}

export type AppData = {
  settings: AppSettings
  workers: Worker[]
  /** שמות ללא כרטיס (שיוך ויזיטור) */
  cardlessPeople: CardlessPerson[]
  people: PersonEntry[]
  banned: BannedPerson[]
  /** טיוטת דוח משמרת נוכחית */
  shiftReport?: ShiftReport
  /** טקסטים קבועים לדוח משמרת (תזכורות / תקלות / הערות) */
  shiftReportTexts?: ShiftReportTexts
  /** ארכיון דוחות לפי תאריך → משמרת */
  shiftReportsArchive?: ShiftReportsArchive
  /** טיוטת דוח מצלמות נוכחית */
  cameraReport?: CameraReport
  /** ארכיון דוחות מצלמות לפי תאריך → משמרת */
  cameraReportsArchive?: CameraReportsArchive
}

export type WhatsAppSendResult = {
  ok: boolean
  error?:
    | 'offline'
    | 'whatsapp_unavailable'
    | 'whatsapp_not_connected'
    | 'failed'
}

export type WhatsAppChannel = 'desktop' | 'web' | 'none'

export type WhatsAppStatus = {
  online: boolean
  whatsappAvailable: boolean
  channel?: WhatsAppChannel
  connected?: boolean
  desktopInstalled?: boolean
  desktopRunning?: boolean
  webOpen?: boolean
  detail?: string
}

export function whatsappStatusLabel(status: WhatsAppStatus): string | null {
  if (!status.online) return 'אין אינטרנט — שליחת חירום עלולה להיכשל'
  if (status.connected || status.whatsappAvailable) return null
  switch (status.detail) {
    case 'web_login':
      return 'WhatsApp Web לא מחובר — לחצו כאן לסריקת קוד QR'
    case 'web_loading':
      return 'בודק חיבור WhatsApp Web… לחצו כאן אם צריך להתחבר'
    case 'web_not_open':
      return 'לחצו כאן להתחברות WhatsApp Web'
    case 'desktop_login':
      return 'WhatsApp פתוח אבל לא מחובר — סרקו את קוד ה־QR באפליקציה'
    case 'desktop_not_running':
      return 'WhatsApp מותקן אך לא פועל — פתחו את האפליקציה והתחברו'
    case 'not_installed':
      return 'לחצו כאן להתחברות WhatsApp Web'
    case 'probe_failed':
      return 'לא ניתן לבדוק את WhatsApp Web — לחצו כאן לנסות שוב'
    default:
      return 'WhatsApp Web לא מחובר — לחצו כאן להתחברות'
  }
}

export type ListeApi = {
  getData: () => Promise<AppData>
  saveData: (data: AppData) => Promise<boolean>
  getShiftReportLocalPath?: () => Promise<{ ok: boolean; path?: string }>
  saveBytes?: (payload: {
    defaultName: string
    bytes: number[]
    filters?: { name: string; extensions: string[] }[]
  }) => Promise<{ ok: boolean; canceled?: boolean; path?: string }>
  copyImage: (dataUrl: string) => Promise<boolean>
  openWhatsApp: () => Promise<boolean>
  shareImageToWhatsApp: (dataUrl: string) => Promise<
    | boolean
    | {
        ok: boolean
        error?:
          | 'whatsapp_not_connected'
          | 'no_chat'
          | 'pending_chat'
          | 'failed'
      }
  >
  getWhatsAppStatus?: () => Promise<WhatsAppStatus>
  openWhatsAppWebSession?: () => Promise<WhatsAppStatus>
  sendWhatsAppText: (
    phone: string | string[],
    text: string,
    imageDataUrl?: string,
  ) => Promise<boolean | WhatsAppSendResult>
  getAppVersion: () => Promise<string>
  checkForUpdates: () => Promise<{
    status: 'available' | 'up-to-date' | 'error'
    version?: string
    currentVersion?: string
    message?: string
  }>
  getPendingUpdate: () => Promise<{
    version: string
    currentVersion: string
  } | null>
  downloadUpdate: () => Promise<boolean>
  installUpdate: () => Promise<boolean>
  pickFolder?: () => Promise<{ ok: boolean; canceled?: boolean; path?: string }>
  saveShiftReportFiles?: (payload: {
    folder: string
    relativeDir: string
    docxFileName: string
    jsonFileName: string
    json: string
    docxBytes: number[]
  }) => Promise<{ ok: boolean; error?: string }>
  deleteShiftReportFiles?: (payload: {
    folder: string
    relativeDir: string
    docxFileName: string
    jsonFileName: string
  }) => Promise<{ ok: boolean; error?: string }>
  saveCameraReportWorkbook?: (payload: {
    folder: string
    relativeDir: string
    fileName: string
    year: number
    month: number
    archive: Record<string, unknown>
    currentReport: Record<string, unknown>
  }) => Promise<{ ok: boolean; error?: string }>
  sendShiftReportTestEmail?: (payload: {
    directorEmail: string
    smtpHost: string
    smtpPort: number
    smtpUser: string
    smtpPass: string
  }) => Promise<{ ok: boolean; error?: string }>
  sendShiftReportsEmail?: (payload: {
    date: string
    directorEmail: string
    smtpHost: string
    smtpPort: number
    smtpUser: string
    smtpPass: string
    attachments: Array<{ name: string; bytes: number[] }>
  }) => Promise<{ ok: boolean; messageId?: string; error?: string }>
  getShiftReportEmailStatus?: (payload: {
    date: string
  }) => Promise<EmailSentStatus>
  getShiftReportEmailSentLog?: () => Promise<ShiftEmailSentLogItem[]>
  sendShiftReportEmail?: (payload: {
    date: string
    force?: boolean
  }) => Promise<EmailSendResult>
  getCameraMonthlyEmailStatus?: (payload: {
    year: number
    month: number
  }) => Promise<EmailSentStatus>
  sendCameraMonthlyEmail?: (payload: {
    year: number
    month: number
    force?: boolean
  }) => Promise<EmailSendResult>
  onUpdateAvailable: (
    cb: (info: { version: string; currentVersion: string }) => void,
  ) => () => void
  onUpdateProgress: (
    cb: (info: { percent: number; transferred: number; total: number }) => void,
  ) => () => void
  onUpdateDownloaded: (cb: (info: { version: string }) => void) => () => void
  onUpdateError: (cb: (info: { message: string }) => void) => () => void
}

declare global {
  interface Window {
    listeApi: ListeApi
  }
}

export function workerDisplayName(w: Worker): string {
  return `${w.firstName} ${w.lastName}`.trim()
}

export function bannedDisplayName(b: BannedPerson): string {
  return `${b.firstName} ${b.lastName}`.trim()
}

export function cardlessDisplayName(c: CardlessPerson): string {
  return `${c.firstName} ${c.lastName}`.trim()
}

export function visitorAffiliatedName(p: PersonEntry): string {
  if (p.kind !== 'visitor') return ''
  return `${p.firstName} ${p.lastName}`.trim()
}

export function displayName(p: PersonEntry): string {
  if (p.kind === 'visitor' && p.visitorNumber != null) {
    const name = visitorAffiliatedName(p)
    return name ? `${name} · ויזיטור ${p.visitorNumber}` : `ויזיטור ${p.visitorNumber}`
  }
  return `${p.firstName} ${p.lastName}`.trim()
}

export function comparePresentByName(a: PersonEntry, b: PersonEntry): number {
  const aVisitor = a.kind === 'visitor' && a.visitorNumber != null
  const bVisitor = b.kind === 'visitor' && b.visitorNumber != null
  // Employés d'abord (alpha), visiteurs à la fin (ordre numérique croissant).
  if (aVisitor !== bVisitor) {
    return aVisitor ? 1 : -1
  }
  if (aVisitor && bVisitor) {
    return a.visitorNumber! - b.visitorNumber!
  }
  return displayName(a).localeCompare(displayName(b), 'he')
}

export function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('he-IL', {
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

/** Heure d'entrée après 07:00 (strictement). */
export function isEnteredAfterSevenAm(iso: string): boolean {
  try {
    const d = new Date(iso)
    return d.getHours() * 60 + d.getMinutes() > 7 * 60
  } catch {
    return false
  }
}

export function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('he-IL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export function isPresent(p: PersonEntry): boolean {
  return !p.exitedAt
}

export function isWorkerPresent(data: AppData, workerId: string): boolean {
  return data.people.some(
    (p) => p.kind === 'named' && p.workerId === workerId && isPresent(p),
  )
}

export function isVisitorPresent(data: AppData, visitorNumber: number): boolean {
  return data.people.some(
    (p) => p.kind === 'visitor' && p.visitorNumber === visitorNumber && isPresent(p),
  )
}

export function isCardlessPresent(data: AppData, cardlessPersonId: string): boolean {
  return data.people.some(
    (p) =>
      p.kind === 'visitor' &&
      p.cardlessPersonId === cardlessPersonId &&
      isPresent(p),
  )
}

/** שם ייחודי שכבר באתר — לא ניתן לבחור שוב */
export function isCardlessBlocked(data: AppData, person: CardlessPerson): boolean {
  return person.assignment === 'unique' && isCardlessPresent(data, person.id)
}

export function buildWhatsAppMessage(
  data: AppData,
  people?: PersonEntry[],
): string {
  const present = people ?? data.people.filter(isPresent)
  const now = new Date().toLocaleString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  const lines: string[] = [
    `📋 ${data.settings.siteName}`,
    `רשימה מ־${now}`,
    '',
    `✅ באתר (${present.length})`,
  ]

  if (present.length === 0) {
    lines.push('— אין אנשים —')
  } else {
    present.forEach((p, i) => {
      lines.push(`${i + 1}. ${displayName(p)} — כניסה ${formatTime(p.enteredAt)}`)
    })
  }

  return lines.join('\n')
}

/** Message urgence : noms seulement + total. */
export function buildEmergencyMessage(
  data: AppData,
  people?: PersonEntry[],
): string {
  const present = [...(people ?? data.people.filter(isPresent))].sort(
    comparePresentByName,
  )
  const lines: string[] = ['🚨 חירום — רשימת נוכחים', '']

  if (present.length === 0) {
    lines.push('— אין אנשים באתר —')
  } else {
    present.forEach((p, i) => {
      lines.push(`${i + 1}. ${displayName(p)}`)
    })
  }

  lines.push('', `סה״כ: ${present.length}`)
  return lines.join('\n')
}

/** Normalise un numéro IL vers format international (chiffres seuls). */
export function normalizeWhatsAppPhone(phone: string): string {
  let digits = phone.replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith('0')) digits = `972${digits.slice(1)}`
  return digits
}

export function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

export function contactDisplayName(c: ContactPhone): string {
  return c.name.trim() || c.phone
}

/** מספרי חירום בלבד (לשליחת חירום) */
export function emergencyDialPhones(contacts: ContactPhone[]): string[] {
  return contacts.filter((c) => c.emergency).map((c) => c.phone)
}

export function normalizeEmergencyPhones(
  raw: unknown,
  directorPhone = '',
): ContactPhone[] {
  const list: ContactPhone[] = []
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string') {
        const trimmed = item.trim()
        if (!trimmed || !normalizeWhatsAppPhone(trimmed)) continue
        list.push({
          id: createId(),
          name: '',
          phone: trimmed,
          emergency: true,
        })
        continue
      }
      if (!item || typeof item !== 'object') continue
      const obj = item as Partial<ContactPhone>
      const phone = String(obj.phone ?? '').trim()
      if (!phone || !normalizeWhatsAppPhone(phone)) continue
      list.push({
        id: typeof obj.id === 'string' && obj.id ? obj.id : createId(),
        name: typeof obj.name === 'string' ? obj.name.trim() : '',
        phone,
        emergency: obj.emergency !== false,
      })
    }
  } else {
    const legacy = directorPhone.trim()
    if (legacy && normalizeWhatsAppPhone(legacy)) {
      list.push({
        id: createId(),
        name: '',
        phone: legacy,
        emergency: true,
      })
    }
  }
  const seen = new Set<string>()
  const unique: ContactPhone[] = []
  for (const contact of list) {
    const key = normalizeWhatsAppPhone(contact.phone)
    if (!key || seen.has(key)) continue
    seen.add(key)
    unique.push(contact)
  }
  return unique
}

/** חצות בסוף היום הנוכחי (מחיקת כרטיס זמני) */
export function endOfTodayMidnight(): string {
  const d = new Date()
  d.setHours(24, 0, 0, 0)
  return d.toISOString()
}

export function isWorkerExpired(w: Worker, now = new Date()): boolean {
  if (!w.temporary || !w.expiresAt) return false
  return new Date(w.expiresAt).getTime() <= now.getTime()
}

export function isCardlessExpired(c: CardlessPerson, now = new Date()): boolean {
  if (!c.temporary || !c.expiresAt) return false
  return new Date(c.expiresAt).getTime() <= now.getTime()
}

export function purgeExpiredWorkers(data: AppData, now = new Date()): AppData {
  const workers = data.workers.filter((w) => !isWorkerExpired(w, now))
  const cardlessPeople = (data.cardlessPeople ?? []).filter(
    (c) => !isCardlessExpired(c, now),
  )
  const visitorSlots = normalizeVisitorSlots(data.settings?.visitorSlots, now)
  const prevSlots = data.settings?.visitorSlots
  const slotsChanged =
    !prevSlots ||
    JSON.stringify(visitorSlots) !== JSON.stringify(prevSlots)

  if (
    workers.length === data.workers.length &&
    cardlessPeople.length === (data.cardlessPeople ?? []).length &&
    !slotsChanged
  ) {
    return data
  }
  return {
    ...data,
    workers,
    cardlessPeople,
    settings: {
      directorPhone: data.settings?.directorPhone ?? '',
      emergencyPhones: normalizeEmergencyPhones(
        data.settings?.emergencyPhones,
        data.settings?.directorPhone ?? '',
      ),
      siteName: data.settings?.siteName ?? 'אתר Chevron',
      visitorSlots,
    },
  }
}

export function getVisitorSlot(data: AppData, visitorNumber: number): VisitorSlot {
  const slots = data.settings?.visitorSlots
  const slot = slots?.[String(visitorNumber)]
  if (slot) return slot
  return { access: 'closed', openUntil: null }
}

export function isVisitorNumberOpen(
  data: AppData,
  visitorNumber: number,
  now = new Date(),
): boolean {
  const slot = getVisitorSlot(data, visitorNumber)
  if (slot.access === 'open_constant') return true
  if (slot.access === 'open_temp') {
    if (!slot.openUntil) return false
    return new Date(slot.openUntil).getTime() > now.getTime()
  }
  return false
}

export function normalizeData(raw: Partial<AppData> | null | undefined): AppData {
  const rawSettings = raw?.settings
  const settings: AppSettings = {
    directorPhone: '',
    emergencyPhones: normalizeEmergencyPhones(
      rawSettings?.emergencyPhones,
      rawSettings?.directorPhone ?? '',
    ),
    siteName: rawSettings?.siteName ?? 'אתר Chevron',
    visitorSlots: normalizeVisitorSlots(rawSettings?.visitorSlots),
    shiftReportSaveFolder:
      typeof rawSettings?.shiftReportSaveFolder === 'string'
        ? rawSettings.shiftReportSaveFolder.trim()
        : '',
    cameraReportSaveFolder:
      typeof rawSettings?.cameraReportSaveFolder === 'string'
        ? rawSettings.cameraReportSaveFolder.trim()
        : '',
    directorEmail:
      typeof rawSettings?.directorEmail === 'string'
        ? rawSettings.directorEmail.trim()
        : '',
    shiftReportEmailTime:
      typeof rawSettings?.shiftReportEmailTime === 'string' &&
      rawSettings.shiftReportEmailTime.trim()
        ? rawSettings.shiftReportEmailTime.trim()
        : '07:00',
    cameraReportEmailTime:
      typeof rawSettings?.cameraReportEmailTime === 'string' &&
      rawSettings.cameraReportEmailTime.trim()
        ? rawSettings.cameraReportEmailTime.trim()
        : '07:00',
    shiftReportEmailMode: normalizeEmailSendMode(rawSettings?.shiftReportEmailMode),
    cameraReportEmailMode: normalizeEmailSendMode(
      rawSettings?.cameraReportEmailMode,
    ),
    shiftReportSmtpHost:
      typeof rawSettings?.shiftReportSmtpHost === 'string'
        ? rawSettings.shiftReportSmtpHost.trim()
        : '',
    shiftReportSmtpPort:
      typeof rawSettings?.shiftReportSmtpPort === 'number' &&
      Number.isFinite(rawSettings.shiftReportSmtpPort)
        ? rawSettings.shiftReportSmtpPort
        : 587,
    shiftReportSmtpUser:
      typeof rawSettings?.shiftReportSmtpUser === 'string'
        ? rawSettings.shiftReportSmtpUser.trim()
        : '',
    shiftReportSmtpPass:
      typeof rawSettings?.shiftReportSmtpPass === 'string'
        ? rawSettings.shiftReportSmtpPass
        : '',
  }
  settings.directorPhone = settings.emergencyPhones[0]?.phone ?? ''
  const workers = (Array.isArray(raw?.workers) ? raw.workers : []).map((w) => ({
    id: w.id,
    firstName: w.firstName,
    lastName: w.lastName,
    temporary: Boolean(w.temporary),
    expiresAt: w.expiresAt ?? null,
  }))
  const cardlessPeople = (
    Array.isArray(raw?.cardlessPeople) ? raw.cardlessPeople : []
  ).map((c) => ({
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    temporary: Boolean(c.temporary),
    expiresAt: c.expiresAt ?? null,
    assignment:
      c.assignment === 'unique' || c.assignment === 'multiple'
        ? c.assignment
        : ('multiple' as const),
  }))
  const people = Array.isArray(raw?.people)
    ? raw.people
        .filter((p) => !p.exitedAt)
        .map((p) => ({
          ...p,
          workerId: p.workerId ?? null,
          cardlessPersonId: p.cardlessPersonId ?? null,
          exitedAt: null,
        }))
    : []
  const banned = (Array.isArray(raw?.banned) ? raw.banned : []).map((b) => ({
    id: b.id,
    firstName: b.firstName,
    lastName: b.lastName,
    reason: b.reason ?? '',
    plateNumber: b.plateNumber ?? '',
    idNumber: b.idNumber ?? '',
    addedAt: b.addedAt ?? new Date().toISOString(),
  }))
  return purgeExpiredWorkers({
    settings,
    workers,
    cardlessPeople,
    people,
    banned,
    shiftReport: normalizeShiftReport(
      raw?.shiftReport,
      normalizeShiftReportTexts(raw?.shiftReportTexts),
    ),
    shiftReportTexts: normalizeShiftReportTexts(raw?.shiftReportTexts),
    shiftReportsArchive:
      raw?.shiftReportsArchive &&
      typeof raw.shiftReportsArchive === 'object' &&
      !Array.isArray(raw.shiftReportsArchive)
        ? raw.shiftReportsArchive
        : {},
    cameraReport: normalizeCameraReport(
      raw?.cameraReport ?? {
        date: formatShiftDate(),
        shift: 'morning',
      },
    ),
    cameraReportsArchive:
      raw?.cameraReportsArchive &&
      typeof raw.cameraReportsArchive === 'object' &&
      !Array.isArray(raw.cameraReportsArchive)
        ? raw.cameraReportsArchive
        : {},
  })
}
