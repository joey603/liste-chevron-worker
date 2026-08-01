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

export type PersonEntry = {
  id: string
  kind: EntryKind
  workerId: string | null
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

export type AppSettings = {
  directorPhone: string
  /** מספרי חירום לשליחת WhatsApp */
  emergencyPhones: string[]
  siteName: string
  /** מצב לכל ויזיטור 1–30 */
  visitorSlots: Record<string, VisitorSlot>
}

export const VISITOR_COUNT = 30

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
  people: PersonEntry[]
  banned: BannedPerson[]
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
  copyImage: (dataUrl: string) => Promise<boolean>
  openWhatsApp: () => Promise<boolean>
  shareImageToWhatsApp: (dataUrl: string) => Promise<boolean>
  getWhatsAppStatus?: () => Promise<WhatsAppStatus>
  openWhatsAppWebSession?: () => Promise<WhatsAppStatus>
  sendWhatsAppText: (
    phone: string | string[],
    text: string,
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

export function displayName(p: PersonEntry): string {
  if (p.kind === 'visitor' && p.visitorNumber != null) {
    return `ויזיטור ${p.visitorNumber}`
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

export function normalizeEmergencyPhones(
  raw: unknown,
  directorPhone = '',
): string[] {
  const list: string[] = []
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item !== 'string') continue
      const trimmed = item.trim()
      if (!trimmed || !normalizeWhatsAppPhone(trimmed)) continue
      list.push(trimmed)
    }
  } else {
    const legacy = directorPhone.trim()
    if (legacy && normalizeWhatsAppPhone(legacy)) {
      list.push(legacy)
    }
  }
  const seen = new Set<string>()
  const unique: string[] = []
  for (const phone of list) {
    const key = normalizeWhatsAppPhone(phone)
    if (!key || seen.has(key)) continue
    seen.add(key)
    unique.push(phone)
  }
  return unique
}

export function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
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

export function purgeExpiredWorkers(data: AppData, now = new Date()): AppData {
  const workers = data.workers.filter((w) => !isWorkerExpired(w, now))
  const visitorSlots = normalizeVisitorSlots(data.settings?.visitorSlots, now)
  const prevSlots = data.settings?.visitorSlots
  const slotsChanged =
    !prevSlots ||
    JSON.stringify(visitorSlots) !== JSON.stringify(prevSlots)

  if (workers.length === data.workers.length && !slotsChanged) {
    return data
  }
  return {
    ...data,
    workers,
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
  }
  settings.directorPhone = settings.emergencyPhones[0] ?? ''
  const workers = (Array.isArray(raw?.workers) ? raw.workers : []).map((w) => ({
    id: w.id,
    firstName: w.firstName,
    lastName: w.lastName,
    temporary: Boolean(w.temporary),
    expiresAt: w.expiresAt ?? null,
  }))
  const people = Array.isArray(raw?.people)
    ? raw.people
        .filter((p) => !p.exitedAt)
        .map((p) => ({
          ...p,
          workerId: p.workerId ?? null,
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
  return purgeExpiredWorkers({ settings, workers, people, banned })
}
