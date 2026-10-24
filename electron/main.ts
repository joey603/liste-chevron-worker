import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  net,
} from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import https from 'node:https'
import { autoUpdater } from 'electron-updater'
import nodemailer from 'nodemailer'
import {
  ensureShiftReportSaveDir,
  shiftReportDocxPathsForDay,
} from './shiftReportPaths'
import { isShiftReportStaffed, type ShiftReport } from '../src/shiftReport'
import {
  buildMonthlyCameraReportFromDisk,
  cameraReportMonthlyWorkbookFileName,
  getPreviousCalendarMonth,
  monthlyCameraReportKey,
  readMonthlyCameraWorkbookFile,
} from './cameraReportMonthly'
import {
  readGuardRosterExcel,
  writeGuardRosterExcel,
} from './guardRosterExcel'
import {
  createAuthorizedListTemplate,
  getAuthorizedListFileMtime,
  readAuthorizedListExcel,
  writeAuthorizedListExcel,
} from './authorizedListExcel'
import {
  buildCameraMonthlyWorkbookBuffer,
  writeCameraMonthlyWorkbook,
} from './cameraReportWorkbook'
import {
  hasLegacyShiftInMain,
  mergeShiftIntoMain,
  persistShiftReportLocalFromAppData,
  readShiftReportLocal,
  shiftReportLocalPath,
  stripShiftFromMain,
} from './shiftReportLocalStore'
import {
  cameraMonthlyEmailStatus,
  getCameraMonthlyEmailSent,
  getShiftEmailSent,
  isShiftReportEmailAlreadySent,
  recordCameraMonthlyEmailSent,
  recordShiftEmailSent,
  shiftEmailStatus,
  listShiftEmailSentLog,
} from './emailSentLog'
import { normalizeShiftReportDateKey } from './shiftReportPaths'

type EmailSendResult = {
  ok: boolean
  alreadySent?: boolean
  sentAt?: string
  messageId?: string
  to?: string
  error?: string
}

function formatArchiveDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}.${mm}.${yyyy}`
}

/** Minutes depuis minuit pour "HH:MM" ; null si invalide. */
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

function hasReachedScheduledTime(now: Date, targetTime: string): boolean {
  const target = parseTimeToMinutes(targetTime) ?? parseTimeToMinutes('07:00')
  if (target == null) return false
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  return nowMinutes >= target
}

async function sendShiftReportsEmail(payload: {
  date: string
  directorEmail: string
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPass: string
  attachments: Array<{ name: string; bytes: number[] }>
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  try {
    const transporter = createSmtpTransporter(payload)
    const info = await transporter.sendMail({
      from: payload.smtpUser,
      to: payload.directorEmail,
      subject: `דוחות משמרת ${payload.date}`,
      text: `מצורפים דוחות המשמרת ליום ${payload.date} (בוקר, צוהריים, לילה).`,
      attachments: payload.attachments.map((a) => ({
        filename: a.name,
        content: Buffer.from(a.bytes),
      })),
    })
    return { ok: true, messageId: info.messageId }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'email_failed',
    }
  }
}

function createSmtpTransporter(payload: {
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPass: string
}) {
  return nodemailer.createTransport({
    host: payload.smtpHost,
    port: payload.smtpPort,
    secure: payload.smtpPort === 465,
    requireTLS: payload.smtpPort === 587,
    auth: {
      user: payload.smtpUser,
      pass: payload.smtpPass,
    },
  })
}

async function sendShiftReportTestEmail(payload: {
  directorEmail: string
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPass: string
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const transporter = createSmtpTransporter(payload)
    await transporter.verify()
    await transporter.sendMail({
      from: payload.smtpUser,
      to: payload.directorEmail,
      subject: 'בדיקת דוא״ל — דוח משמרת',
      text:
        'זוהי הודעת בדיקה מ־Liste Chevron.\n' +
        'אם קיבלתם אותה, הגדרות ה-SMTP תקינות.',
    })
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'email_test_failed',
    }
  }
}

async function sendCameraMonthlyReportEmail(payload: {
  monthKey: string
  hebrewMonth: string
  year: number
  directorEmail: string
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPass: string
  attachmentName: string
  attachmentBytes: Buffer
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  try {
    const transporter = createSmtpTransporter(payload)
    const info = await transporter.sendMail({
      from: payload.smtpUser,
      to: payload.directorEmail,
      subject: `יומן מצלמות ${payload.hebrewMonth} ${payload.year}`,
      text:
        `מצורף יומן המצלמות המלא לחודש ${payload.hebrewMonth} ${payload.year}.\n` +
        `(נשלח אוטומטית ב-1 לחודש — החודש הקודם.)`,
      attachments: [
        {
          filename: payload.attachmentName,
          content: payload.attachmentBytes,
        },
      ],
    })
    return { ok: true, messageId: info.messageId }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'email_failed',
    }
  }
}

function normalizeEmailSendMode(raw: unknown): 'auto' | 'manual' {
  return raw === 'manual' ? 'manual' : 'auto'
}

function getEmailConfig(data: AppData): {
  email: string
  smtpHost: string
  smtpUser: string
  smtpPass: string
  smtpPort: number
} | null {
  const email = data.settings.directorEmail?.trim()
  const smtpHost = data.settings.shiftReportSmtpHost?.trim()
  const smtpUser = data.settings.shiftReportSmtpUser?.trim()
  const smtpPass = data.settings.shiftReportSmtpPass ?? ''
  const smtpPort = data.settings.shiftReportSmtpPort ?? 587
  if (!email || !smtpHost || !smtpUser || !smtpPass) return null
  return { email, smtpHost, smtpUser, smtpPass, smtpPort }
}

function buildShiftAttachmentsForDate(
  folder: string,
  dateKey: string,
  archive?: Record<string, Record<string, unknown>>,
): Array<{ name: string; bytes: number[] }> {
  const dayArchive = resolveShiftArchiveDay(archive, dateKey)
  const shifts = shiftReportDocxPathsForDay(dateKey)
  const attachments: Array<{ name: string; bytes: number[] }> = []
  for (const item of shifts) {
    const report = dayArchive?.[item.shift]
    if (!isShiftReportStaffed(report as ShiftReport)) {
      continue
    }
    const dir = ensureShiftReportSaveDir(folder, item.relativeDir)
    const docxPath = path.join(dir, item.fileName)
    if (!fs.existsSync(docxPath)) continue
    attachments.push({
      name: item.fileName,
      bytes: [...fs.readFileSync(docxPath)],
    })
  }
  return attachments
}

function hasStaffedShiftsForDay(
  archive: Record<string, Record<string, unknown>> | undefined,
  dateKey: string,
): boolean {
  const dayArchive = resolveShiftArchiveDay(archive, dateKey)
  if (!dayArchive) return false
  return (['morning', 'afternoon', 'night'] as const).some((shift) =>
    isShiftReportStaffed(dayArchive[shift] as ShiftReport),
  )
}

function resolveShiftArchiveDay(
  archive: Record<string, Record<string, unknown>> | undefined,
  dateKey: string,
): Record<string, unknown> | undefined {
  if (!archive) return undefined
  const normalized = normalizeShiftReportDateKey(dateKey)
  if (normalized && archive[normalized]) return archive[normalized]
  const trimmed = dateKey.trim()
  if (archive[trimmed]) return archive[trimmed]
  return undefined
}

async function sendShiftReportForDate(
  dateKey: string,
  options?: { force?: boolean },
): Promise<EmailSendResult> {
  const normalizedDate = normalizeShiftReportDateKey(dateKey)
  if (!normalizedDate) {
    return { ok: false, error: 'invalid_date' }
  }

  const existing = getShiftEmailSent(normalizedDate)
  if (existing && !options?.force) {
    return {
      ok: false,
      alreadySent: true,
      sentAt: existing.sentAt,
      messageId: existing.messageId,
      to: existing.to || undefined,
    }
  }

  const data = readData()
  const cfg = getEmailConfig(data)
  const folder = data.settings.shiftReportSaveFolder?.trim()
  if (!cfg || !folder) {
    return { ok: false, error: 'missing_config' }
  }

  const archive = data.shiftReportsArchive as
    | Record<string, Record<string, unknown>>
    | undefined
  if (!hasStaffedShiftsForDay(archive, normalizedDate)) {
    return { ok: false, error: 'no_report_data' }
  }

  const attachments = buildShiftAttachmentsForDate(
    folder,
    normalizedDate,
    archive,
  )
  if (attachments.length === 0) {
    return { ok: false, error: 'no_attachments' }
  }

  const result = await sendShiftReportsEmail({
    date: normalizedDate,
    directorEmail: cfg.email,
    smtpHost: cfg.smtpHost,
    smtpPort: cfg.smtpPort,
    smtpUser: cfg.smtpUser,
    smtpPass: cfg.smtpPass,
    attachments,
  })

  if (!result.ok) {
    return { ok: false, error: result.error }
  }

  const sentAt = new Date().toISOString()
  recordShiftEmailSent(normalizedDate, {
    sentAt,
    messageId: result.messageId,
    to: cfg.email,
  })
  return { ok: true, sentAt, messageId: result.messageId }
}

async function sendCameraMonthlyForMonth(
  year: number,
  month: number,
  options?: { force?: boolean },
): Promise<EmailSendResult> {
  const monthKey = monthlyCameraReportKey(year, month)
  const existing = getCameraMonthlyEmailSent(monthKey)
  if (existing && !options?.force) {
    return {
      ok: false,
      alreadySent: true,
      sentAt: existing.sentAt,
      messageId: existing.messageId,
      to: existing.to || undefined,
    }
  }

  const data = readData()
  const cfg = getEmailConfig(data)
  const folder =
    data.settings.cameraReportSaveFolder?.trim() ||
    data.settings.shiftReportSaveFolder?.trim()
  if (!cfg || !folder) {
    return { ok: false, error: 'missing_config' }
  }

  const fileName = cameraReportMonthlyWorkbookFileName(year, month)
  let bytes = readMonthlyCameraWorkbookFile(folder, year, month)
  let hebrewMonth = String(month)

  if (!bytes) {
    const built = buildMonthlyCameraReportFromDisk(folder, year, month)
    if (!built) {
      return { ok: false, error: 'no_workbook' }
    }
    hebrewMonth = built.hebrewMonth
    try {
      bytes = await buildCameraMonthlyWorkbookBuffer({
        year,
        month,
        archive: built.days,
      })
    } catch {
      return { ok: false, error: 'workbook_build_failed' }
    }
  } else {
    hebrewMonth =
      buildMonthlyCameraReportFromDisk(folder, year, month)?.hebrewMonth ??
      fileName.match(/יומן מצלמות (\S+)/)?.[1] ??
      String(month)
  }

  const result = await sendCameraMonthlyReportEmail({
    monthKey,
    hebrewMonth,
    year,
    directorEmail: cfg.email,
    smtpHost: cfg.smtpHost,
    smtpPort: cfg.smtpPort,
    smtpUser: cfg.smtpUser,
    smtpPass: cfg.smtpPass,
    attachmentName: fileName,
    attachmentBytes: bytes,
  })

  if (!result.ok) {
    return { ok: false, error: result.error }
  }

  const sentAt = new Date().toISOString()
  recordCameraMonthlyEmailSent(monthKey, {
    sentAt,
    messageId: result.messageId,
    to: cfg.email,
  })
  return { ok: true, sentAt, messageId: result.messageId }
}

function trySendMonthlyCameraReports() {
  const data = readData()
  const email = data.settings.directorEmail?.trim()
  const smtpHost = data.settings.shiftReportSmtpHost?.trim()
  const smtpUser = data.settings.shiftReportSmtpUser?.trim()
  const smtpPass = data.settings.shiftReportSmtpPass ?? ''
  const folder =
    data.settings.cameraReportSaveFolder?.trim() ||
    data.settings.shiftReportSaveFolder?.trim()
  if (!email || !smtpHost || !smtpUser || !smtpPass || !folder) return
  if (normalizeEmailSendMode(data.settings.cameraReportEmailMode) === 'manual') {
    return
  }

  const now = new Date()
  if (now.getDate() !== 1) return

  const targetTime =
    data.settings.cameraReportEmailTime?.trim() ||
    data.settings.shiftReportEmailTime?.trim() ||
    '07:00'
  // Après l'heure prévue (pas seulement la minute exacte) — sinon un tick raté = pas d'envoi
  if (!hasReachedScheduledTime(now, targetTime)) return

  const { month, year } = getPreviousCalendarMonth(now)
  const monthKey = monthlyCameraReportKey(year, month)
  if (getCameraMonthlyEmailSent(monthKey)) return

  void sendCameraMonthlyForMonth(year, month).then((result) => {
    if (!result.ok && !result.alreadySent) {
      console.warn('[camera-email-auto]', monthKey, result.error)
    }
  })
}

function trySendDailyShiftReports() {
  const data = readData()
  const email = data.settings.directorEmail?.trim()
  const smtpHost = data.settings.shiftReportSmtpHost?.trim()
  const smtpUser = data.settings.shiftReportSmtpUser?.trim()
  const smtpPass = data.settings.shiftReportSmtpPass ?? ''
  const folder = data.settings.shiftReportSaveFolder?.trim()
  if (!email || !smtpHost || !smtpUser || !smtpPass || !folder) return
  if (normalizeEmailSendMode(data.settings.shiftReportEmailMode) === 'manual') {
    return
  }

  const now = new Date()
  const targetTime = data.settings.shiftReportEmailTime?.trim() || '07:00'
  // Après l'heure prévue (pas seulement la minute exacte) — sinon un tick raté = pas d'envoi
  if (!hasReachedScheduledTime(now, targetTime)) return

  const reportDay = new Date(now)
  reportDay.setDate(reportDay.getDate() - 1)
  const dateKey = formatArchiveDate(reportDay)
  if (isShiftReportEmailAlreadySent(dateKey)) return

  void sendShiftReportForDate(dateKey).then((result) => {
    if (!result.ok && !result.alreadySent) {
      console.warn('[shift-email-auto]', dateKey, result.error)
    }
  })
}

type EntryKind = 'named' | 'visitor'

type Worker = {
  id: string
  firstName: string
  lastName: string
  temporary: boolean
  expiresAt: string | null
}

type CardlessPerson = {
  id: string
  firstName: string
  lastName: string
  temporary: boolean
  expiresAt: string | null
  assignment: 'unique' | 'multiple'
}

type PersonEntry = {
  id: string
  kind: EntryKind
  workerId: string | null
  cardlessPersonId: string | null
  firstName: string
  lastName: string
  visitorNumber: number | null
  enteredAt: string
  exitedAt: string | null
}

type VisitorSlot = {
  access: 'closed' | 'open_temp' | 'open_constant'
  openUntil: string | null
}

type ContactPhone = {
  id: string
  name: string
  phone: string
  emergency: boolean
}

type AppSettings = {
  directorPhone: string
  emergencyPhones: ContactPhone[]
  siteName: string
  visitorSlots: Record<string, VisitorSlot>
  shiftReportSaveFolder?: string
  cameraReportSaveFolder?: string
  guardRosterExcelPath?: string
  authorizedListExcelPath?: string
  authorizedListSyncTime?: string
  authorizedListLastSyncedAt?: string
  directorEmail?: string
  shiftReportEmailTime?: string
  shiftReportEmailMode?: 'auto' | 'manual'
  cameraReportEmailTime?: string
  cameraReportEmailMode?: 'auto' | 'manual'
  shiftReportSmtpHost?: string
  shiftReportSmtpPort?: number
  shiftReportSmtpUser?: string
  shiftReportSmtpPass?: string
  absenceWatchPhone?: string
  absenceWatchWorkerId?: string
  absenceWatchEnabled?: boolean
  telegramBotToken?: string
  telegramChatId?: string
}

type BannedPerson = {
  id: string
  firstName: string
  lastName: string
  reason: string
  plateNumber: string
  idNumber: string
  addedAt: string
}

type AuthorizedPerson = {
  id: string
  firstName: string
  lastName: string
  idNumber: string
  kind: 'permanent' | 'visitor'
  notes: string
  updatedAt: string
}

type GuardRosterEntry = {
  id: string
  firstName: string
  lastName: string
  phone: string
  address: string
  emergencyContactName: string
  emergencyContactPhone: string
  job: string
  company: string
  shift: string
  idCard: string
  addedAt: string
}

type AppData = {
  settings: AppSettings
  workers: Worker[]
  cardlessPeople: CardlessPerson[]
  people: PersonEntry[]
  banned: BannedPerson[]
  authorizedPeople: AuthorizedPerson[]
  guards: GuardRosterEntry[]
  shiftReport?: unknown
  shiftReportTexts?: unknown
  shiftReportsArchive?: Record<string, unknown>
  cameraReport?: unknown
  cameraReportsArchive?: Record<string, unknown>
}

function defaultVisitorSlots(): Record<string, VisitorSlot> {
  const slots: Record<string, VisitorSlot> = {}
  for (let n = 1; n <= 30; n++) {
    slots[String(n)] = { access: 'closed', openUntil: null }
  }
  return slots
}

function normalizeVisitorSlots(
  raw: Record<string, Partial<VisitorSlot>> | undefined,
  now: number,
): Record<string, VisitorSlot> {
  const slots = defaultVisitorSlots()
  if (!raw || typeof raw !== 'object') return slots
  for (let n = 1; n <= 30; n++) {
    const key = String(n)
    const item = raw[key]
    if (!item) continue
    let access: VisitorSlot['access'] = 'closed'
    if (
      item.access === 'open_temp' ||
      item.access === 'open_constant' ||
      item.access === 'closed'
    ) {
      access = item.access
    }
    let openUntil = item.openUntil ?? null
    if (access === 'open_temp') {
      if (!openUntil || new Date(openUntil).getTime() <= now) {
        access = 'closed'
        openUntil = null
      }
    } else {
      openUntil = null
    }
    slots[key] = { access, openUntil }
  }
  return slots
}

const defaultData = (): AppData => ({
  settings: {
    directorPhone: '',
    emergencyPhones: [],
    siteName: 'אתר Chevron',
    visitorSlots: defaultVisitorSlots(),
  },
  workers: [],
  cardlessPeople: [],
  people: [],
  banned: [],
  authorizedPeople: [],
  guards: [],
})

function dataPath() {
  return path.join(app.getPath('userData'), 'liste-data.json')
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

function normalizeEmergencyPhones(
  raw: unknown,
  directorPhone = '',
): ContactPhone[] {
  const list: ContactPhone[] = []
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string') {
        const trimmed = item.trim()
        if (!trimmed) continue
        list.push({
          id: makeId(),
          name: '',
          phone: trimmed,
          emergency: true,
        })
        continue
      }
      if (!item || typeof item !== 'object') continue
      const obj = item as Partial<ContactPhone>
      const phone = String(obj.phone ?? '').trim()
      if (!phone) continue
      list.push({
        id: typeof obj.id === 'string' && obj.id ? obj.id : makeId(),
        name: typeof obj.name === 'string' ? obj.name.trim() : '',
        phone,
        emergency: obj.emergency !== false,
      })
    }
  } else if (directorPhone.trim()) {
    list.push({
      id: makeId(),
      name: '',
      phone: directorPhone.trim(),
      emergency: true,
    })
  }
  const seen = new Set<string>()
  const unique: ContactPhone[] = []
  for (const contact of list) {
    const key = contact.phone.replace(/\D/g, '')
    if (!key || seen.has(key)) continue
    seen.add(key)
    unique.push(contact)
  }
  return unique
}

function normalize(raw: Partial<AppData>): AppData {
  const now = Date.now()
  const workers = (Array.isArray(raw.workers) ? raw.workers : [])
    .map((w) => ({
      id: w.id,
      firstName: w.firstName,
      lastName: w.lastName,
      temporary: Boolean(w.temporary),
      expiresAt: w.expiresAt ?? null,
    }))
    .filter((w) => {
      if (!w.temporary || !w.expiresAt) return true
      return new Date(w.expiresAt).getTime() > now
    })

  const cardlessPeople = (
    Array.isArray(raw.cardlessPeople) ? raw.cardlessPeople : []
  )
    .map((c) => ({
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
    .filter((c) => {
      if (!c.temporary || !c.expiresAt) return true
      return new Date(c.expiresAt).getTime() > now
    })

  const emergencyPhones = normalizeEmergencyPhones(
    raw.settings?.emergencyPhones,
    raw.settings?.directorPhone ?? '',
  )

  const settings = {
    ...defaultData().settings,
    ...raw.settings,
    emergencyPhones,
    directorPhone: emergencyPhones[0]?.phone ?? '',
    visitorSlots: normalizeVisitorSlots(raw.settings?.visitorSlots, now),
    shiftReportSaveFolder:
      typeof raw.settings?.shiftReportSaveFolder === 'string'
        ? raw.settings.shiftReportSaveFolder.trim()
        : '',
    cameraReportSaveFolder:
      typeof raw.settings?.cameraReportSaveFolder === 'string'
        ? raw.settings.cameraReportSaveFolder.trim()
        : '',
    guardRosterExcelPath:
      typeof raw.settings?.guardRosterExcelPath === 'string'
        ? raw.settings.guardRosterExcelPath.trim()
        : '',
    authorizedListExcelPath:
      typeof raw.settings?.authorizedListExcelPath === 'string'
        ? raw.settings.authorizedListExcelPath.trim()
        : '',
    authorizedListSyncTime:
      typeof raw.settings?.authorizedListSyncTime === 'string' &&
      raw.settings.authorizedListSyncTime.trim()
        ? raw.settings.authorizedListSyncTime.trim()
        : '07:00',
    authorizedListLastSyncedAt:
      typeof raw.settings?.authorizedListLastSyncedAt === 'string'
        ? raw.settings.authorizedListLastSyncedAt.trim()
        : '',
    directorEmail:
      typeof raw.settings?.directorEmail === 'string'
        ? raw.settings.directorEmail.trim()
        : '',
    shiftReportEmailTime:
      typeof raw.settings?.shiftReportEmailTime === 'string' &&
      raw.settings.shiftReportEmailTime.trim()
        ? raw.settings.shiftReportEmailTime.trim()
        : '07:00',
    cameraReportEmailTime:
      typeof raw.settings?.cameraReportEmailTime === 'string' &&
      raw.settings.cameraReportEmailTime.trim()
        ? raw.settings.cameraReportEmailTime.trim()
        : '07:00',
    shiftReportEmailMode: normalizeEmailSendMode(
      raw.settings?.shiftReportEmailMode,
    ),
    cameraReportEmailMode: normalizeEmailSendMode(
      raw.settings?.cameraReportEmailMode,
    ),
    shiftReportSmtpHost:
      typeof raw.settings?.shiftReportSmtpHost === 'string'
        ? raw.settings.shiftReportSmtpHost.trim()
        : '',
    shiftReportSmtpPort:
      typeof raw.settings?.shiftReportSmtpPort === 'number' &&
      Number.isFinite(raw.settings.shiftReportSmtpPort)
        ? raw.settings.shiftReportSmtpPort
        : 587,
    shiftReportSmtpUser:
      typeof raw.settings?.shiftReportSmtpUser === 'string'
        ? raw.settings.shiftReportSmtpUser.trim()
        : '',
    shiftReportSmtpPass:
      typeof raw.settings?.shiftReportSmtpPass === 'string'
        ? raw.settings.shiftReportSmtpPass
        : '',
    absenceWatchPhone:
      typeof raw.settings?.absenceWatchPhone === 'string'
        ? raw.settings.absenceWatchPhone.trim()
        : '',
    absenceWatchWorkerId:
      typeof raw.settings?.absenceWatchWorkerId === 'string'
        ? raw.settings.absenceWatchWorkerId.trim()
        : '',
    absenceWatchEnabled: raw.settings?.absenceWatchEnabled === true,
    telegramBotToken:
      typeof raw.settings?.telegramBotToken === 'string'
        ? raw.settings.telegramBotToken.trim()
        : '',
    telegramChatId:
      typeof raw.settings?.telegramChatId === 'string'
        ? raw.settings.telegramChatId.trim()
        : '',
  }

  return {
    settings,
    workers,
    cardlessPeople,
    people: Array.isArray(raw.people)
      ? raw.people.map((p) => ({
          ...p,
          workerId: p.workerId ?? null,
          cardlessPersonId: p.cardlessPersonId ?? null,
        }))
      : [],
    banned: Array.isArray(raw.banned)
      ? raw.banned.map((b) => ({
          id: b.id,
          firstName: b.firstName,
          lastName: b.lastName,
          reason: b.reason ?? '',
          plateNumber: b.plateNumber ?? '',
          idNumber: b.idNumber ?? '',
          addedAt: b.addedAt ?? new Date().toISOString(),
        }))
      : [],
    authorizedPeople: Array.isArray(raw.authorizedPeople)
      ? raw.authorizedPeople.map((p) => {
          const notes = typeof p?.notes === 'string' ? p.notes : ''
          const rawKind = typeof p?.kind === 'string' ? p.kind : notes
          const kind: 'permanent' | 'visitor' =
            rawKind === 'visitor' ||
            rawKind === 'וויזיטור' ||
            rawKind === 'ויזיטור' ||
            rawKind === 'ללא כרטיס'
              ? 'visitor'
              : 'permanent'
          return {
            id: typeof p?.id === 'string' ? p.id : makeId(),
            firstName: typeof p?.firstName === 'string' ? p.firstName : '',
            lastName: typeof p?.lastName === 'string' ? p.lastName : '',
            idNumber: typeof p?.idNumber === 'string' ? p.idNumber : '',
            kind,
            notes:
              notes === 'עובד' ||
              notes === 'ללא כרטיס' ||
              notes === 'קבוע' ||
              notes === 'וויזיטור' ||
              notes === 'ויזיטור'
                ? ''
                : notes,
            updatedAt:
              typeof p?.updatedAt === 'string'
                ? p.updatedAt
                : new Date().toISOString(),
          }
        })
      : [],
    guards: Array.isArray(raw.guards)
      ? raw.guards.map((g) => ({
          id: typeof g?.id === 'string' ? g.id : makeId(),
          firstName: typeof g?.firstName === 'string' ? g.firstName : '',
          lastName: typeof g?.lastName === 'string' ? g.lastName : '',
          phone: typeof g?.phone === 'string' ? g.phone : '',
          address: typeof g?.address === 'string' ? g.address : '',
          emergencyContactName:
            typeof g?.emergencyContactName === 'string'
              ? g.emergencyContactName
              : '',
          emergencyContactPhone:
            typeof g?.emergencyContactPhone === 'string'
              ? g.emergencyContactPhone
              : '',
          job:
            typeof g?.job === 'string' && g.job.trim() ? g.job : 'guard',
          company:
            typeof g?.company === 'string' && g.company.trim()
              ? g.company
              : 'G1',
          shift: typeof g?.shift === 'string' ? g.shift : '',
          idCard: typeof g?.idCard === 'string' ? g.idCard : '',
          addedAt:
            typeof g?.addedAt === 'string'
              ? g.addedAt
              : new Date().toISOString(),
        }))
      : [],
    shiftReport: raw.shiftReport,
    shiftReportTexts: raw.shiftReportTexts,
    shiftReportsArchive:
      raw.shiftReportsArchive &&
      typeof raw.shiftReportsArchive === 'object' &&
      !Array.isArray(raw.shiftReportsArchive)
        ? raw.shiftReportsArchive
        : {},
    cameraReport: raw.cameraReport,
    cameraReportsArchive:
      raw.cameraReportsArchive &&
      typeof raw.cameraReportsArchive === 'object' &&
      !Array.isArray(raw.cameraReportsArchive)
        ? raw.cameraReportsArchive
        : {},
  }
}

function readMainDataFile(): Partial<AppData> {
  const file = dataPath()
  try {
    if (!fs.existsSync(file)) {
      const data = defaultData()
      fs.writeFileSync(file, JSON.stringify(stripShiftFromMain(data), null, 2), 'utf-8')
      return data
    }
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<AppData>
  } catch {
    return defaultData()
  }
}

function readData(): AppData {
  const rawMain = readMainDataFile()
  const shiftLocal = readShiftReportLocal(rawMain)
  const merged = mergeShiftIntoMain(rawMain, shiftLocal)
  const data = normalize(merged)

  if (hasLegacyShiftInMain(rawMain)) {
    persistShiftReportLocalFromAppData(data)
    fs.writeFileSync(
      dataPath(),
      JSON.stringify(stripShiftFromMain(data), null, 2),
      'utf-8',
    )
  }

  return data
}

function writeData(data: AppData) {
  const normalized = normalize(data)
  persistShiftReportLocalFromAppData(normalized)
  fs.writeFileSync(
    dataPath(),
    JSON.stringify(stripShiftFromMain(normalized), null, 2),
    'utf-8',
  )
}

function sendToWindows(channel: string, payload?: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

type PendingUpdate = { version: string; currentVersion: string }

let pendingUpdate: PendingUpdate | null = null
let lastUpdateError: string | null = null

function setupAutoUpdater(getMainWindow: () => BrowserWindow | null) {
  const check = async () => {
    if (!app.isPackaged) return null
    try {
      const result = await autoUpdater.checkForUpdates()
      return result
    } catch (error) {
      lastUpdateError =
        error instanceof Error ? error.message : 'Update check failed'
      sendToWindows('update:error', { message: lastUpdateError })
      return null
    }
  }

  const pendingUpdateResult = (update: PendingUpdate) => ({
    status: 'available' as const,
    version: update.version,
    currentVersion: update.currentVersion,
  })

  const readPendingUpdate = (): PendingUpdate | null => pendingUpdate

  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) {
      return { status: 'up-to-date' as const, version: app.getVersion() }
    }
    const initial = readPendingUpdate()
    if (initial) {
      sendToWindows('update:available', initial)
      return pendingUpdateResult(initial)
    }
    lastUpdateError = null
    await check()
    const afterCheck = readPendingUpdate()
    if (afterCheck) {
      return pendingUpdateResult(afterCheck)
    }
    if (lastUpdateError) {
      return { status: 'error' as const, message: lastUpdateError }
    }
    return { status: 'up-to-date' as const, version: app.getVersion() }
  })

  ipcMain.handle('update:getPending', () => pendingUpdate)

  if (!app.isPackaged) return

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowDowngrade = false

  try {
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'joey603',
      repo: 'liste-chevron-worker',
    })
  } catch {
    /* keep defaults from app-update.yml */
  }

  autoUpdater.on('update-available', (info) => {
    pendingUpdate = {
      version: info.version,
      currentVersion: app.getVersion(),
    }
    lastUpdateError = null
    sendToWindows('update:available', pendingUpdate)
  })

  autoUpdater.on('update-not-available', () => {
    pendingUpdate = null
    sendToWindows('update:not-available')
  })

  autoUpdater.on('download-progress', (progress) => {
    sendToWindows('update:progress', {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    sendToWindows('update:downloaded', { version: info.version })
  })

  autoUpdater.on('error', (error) => {
    lastUpdateError = error?.message || 'Update failed'
    sendToWindows('update:error', { message: lastUpdateError })
  })

  const win = getMainWindow()
  if (win) {
    win.webContents.once('did-finish-load', () => {
      void check()
    })
  } else {
    setTimeout(() => void check(), 2500)
  }
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

type TelegramSendResult = { ok: boolean; error?: string }

function parseTelegramResponse(raw: string): TelegramSendResult {
  try {
    const parsed = JSON.parse(raw) as { ok?: boolean; description?: string }
    if (parsed.ok) return { ok: true }
    return { ok: false, error: parsed.description || 'telegram_failed' }
  } catch {
    return { ok: false, error: 'telegram_failed' }
  }
}

function telegramHttpsRequest(
  token: string,
  method: string,
  payload: Buffer,
  contentType: string,
): Promise<TelegramSendResult> {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${token}/${method}`,
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          'Content-Length': payload.length,
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c as Buffer))
        res.on('end', () =>
          resolve(parseTelegramResponse(Buffer.concat(chunks).toString('utf8'))),
        )
      },
    )
    req.on('error', () => resolve({ ok: false, error: 'offline' }))
    req.write(payload)
    req.end()
  })
}

function telegramApiPost(
  token: string,
  method: string,
  body: Record<string, string>,
): Promise<TelegramSendResult> {
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  return telegramHttpsRequest(token, method, payload, 'application/json')
}

function telegramApiMultipart(
  token: string,
  method: string,
  fields: Record<string, string>,
  file: { field: string; filename: string; buffer: Buffer; mime: string },
): Promise<TelegramSendResult> {
  const boundary = `chevron${Date.now().toString(16)}`
  const parts: Buffer[] = []
  for (const [key, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
        'utf8',
      ),
    )
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.mime}\r\n\r\n`,
      'utf8',
    ),
  )
  parts.push(file.buffer)
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'))
  return telegramHttpsRequest(
    token,
    method,
    Buffer.concat(parts),
    `multipart/form-data; boundary=${boundary}`,
  )
}

function readTelegramSettings(): { token: string; chatId: string } {
  const data = readData()
  return {
    token: (data.settings.telegramBotToken ?? '').trim(),
    chatId: (data.settings.telegramChatId ?? '').trim(),
  }
}

async function sendTelegramText(
  token: string,
  chatId: string,
  text: string,
): Promise<TelegramSendResult> {
  const bot = token.trim()
  const chat = chatId.trim()
  const message = text.trim()
  if (!bot || !chat) return { ok: false, error: 'telegram_not_configured' }
  if (!message) return { ok: false, error: 'failed' }
  // Telegram limite ~4096 caractères par message
  const chunks: string[] = []
  let rest = message
  while (rest.length > 4000) {
    let cut = rest.lastIndexOf('\n', 4000)
    if (cut < 1000) cut = 4000
    chunks.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^\n+/, '')
  }
  if (rest) chunks.push(rest)
  for (const chunk of chunks) {
    const sent = await telegramApiPost(bot, 'sendMessage', {
      chat_id: chat,
      text: chunk,
    })
    if (!sent.ok) return sent
  }
  return { ok: true }
}

async function sendTelegramPhoto(
  token: string,
  chatId: string,
  imageDataUrl: string,
  caption?: string,
): Promise<TelegramSendResult> {
  const bot = token.trim()
  const chat = chatId.trim()
  if (!bot || !chat) return { ok: false, error: 'telegram_not_configured' }
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(
    imageDataUrl.trim(),
  )
  if (!match) return { ok: false, error: 'failed' }
  const mime = match[1]
  const buffer = Buffer.from(match[2], 'base64')
  if (buffer.length === 0) return { ok: false, error: 'failed' }
  const fields: Record<string, string> = { chat_id: chat }
  const cap = (caption ?? '').trim()
  if (cap) fields.caption = cap.slice(0, 1024)
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg'
  return telegramApiMultipart(bot, 'sendPhoto', fields, {
    field: 'photo',
    filename: `list.${ext}`,
    buffer,
    mime,
  })
}

function createWindow() {
  const icon = resolveAppIcon()
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1000,
    minHeight: 700,
    title: 'רשימת Chevron',
    backgroundColor: '#eef3f8',
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.on('closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.chevron.liste-travailleurs')
  }
  ipcMain.handle('data:get', () => readData())

  ipcMain.handle('data:save', (_event, data: AppData) => {
    writeData(data)
    return true
  })

  ipcMain.handle('shiftReport:localPath', () => ({
    ok: true as const,
    path: shiftReportLocalPath(),
  }))

  ipcMain.handle('telegram:sendText', async (_event, text: string) => {
    const { token, chatId } = readTelegramSettings()
    return sendTelegramText(token, chatId, String(text || ''))
  })

  ipcMain.handle(
    'telegram:sendPhoto',
    async (_event, imageDataUrl: string, caption?: string) => {
      const { token, chatId } = readTelegramSettings()
      return sendTelegramPhoto(
        token,
        chatId,
        String(imageDataUrl || ''),
        caption ? String(caption) : undefined,
      )
    },
  )

  ipcMain.handle('telegram:test', async () => {
    const { token, chatId } = readTelegramSettings()
    const sent = await sendTelegramText(
      token,
      chatId,
      'בדיקת Telegram — Chevron',
    )
    if (sent.ok) return { ok: true as const, chatId }
    return sent
  })

  ipcMain.handle('clipboard:writeImage', (_event, dataUrl: string) => {
    const image = nativeImage.createFromDataURL(dataUrl)
    clipboard.writeImage(image)
    return true
  })

  function refocusMainWindow(sender?: Electron.WebContents) {
    const fromSender = sender
      ? BrowserWindow.fromWebContents(sender)
      : null
    const win =
      fromSender && !fromSender.isDestroyed()
        ? fromSender
        : BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    try {
      win.webContents.focus()
    } catch {
      /* ignore */
    }
  }

  ipcMain.handle(
    'file:saveBytes',
    async (
      event,
      payload: { defaultName: string; bytes: number[]; filters?: { name: string; extensions: string[] }[] },
    ) => {
      try {
        const result = await dialog.showSaveDialog({
          defaultPath: payload.defaultName,
          filters: payload.filters ?? [
            { name: 'Word', extensions: ['docx'] },
          ],
        })
        if (result.canceled || !result.filePath) {
          return { ok: false as const, canceled: true as const }
        }
        fs.writeFileSync(result.filePath, Buffer.from(payload.bytes))
        return { ok: true as const, path: result.filePath }
      } finally {
        refocusMainWindow(event.sender)
      }
    },
  )

  ipcMain.handle('folder:pick', async (event) => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
      })
      if (result.canceled || !result.filePaths[0]) {
        return { ok: false as const, canceled: true as const }
      }
      return { ok: true as const, path: result.filePaths[0] }
    } finally {
      refocusMainWindow(event.sender)
    }
  })

  ipcMain.handle('guardRoster:pickExcel', async (event) => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'בחירת קובץ רוסטר Excel',
        properties: ['openFile'],
        filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
      })
      if (result.canceled || !result.filePaths[0]) {
        return { ok: false as const, canceled: true as const }
      }
      return { ok: true as const, path: result.filePaths[0] }
    } finally {
      refocusMainWindow(event.sender)
    }
  })

  ipcMain.handle(
    'guardRoster:readExcel',
    async (_event, filePath: string) => readGuardRosterExcel(String(filePath || '')),
  )

  ipcMain.handle(
    'guardRoster:writeExcel',
    async (
      _event,
      payload: {
        filePath: string
        guards: Array<{
          id: string
          firstName: string
          lastName: string
          phone: string
          address: string
          emergencyContactName: string
          emergencyContactPhone: string
          job?: string
          company?: string
          shift?: string
          idCard?: string
          addedAt?: string
        }>
      },
    ) => {
      const rows = (payload.guards ?? []).map((g) => ({
        id: g.id,
        firstName: g.firstName ?? '',
        lastName: g.lastName ?? '',
        phone: g.phone ?? '',
        address: g.address ?? '',
        emergencyContactName: g.emergencyContactName ?? '',
        emergencyContactPhone: g.emergencyContactPhone ?? '',
        job: g.job ?? 'guard',
        company: g.company ?? 'G1',
        shift: g.shift ?? '',
        idCard: g.idCard ?? '',
        addedAt: g.addedAt ?? new Date().toISOString(),
      }))
      return writeGuardRosterExcel(String(payload.filePath || ''), rows)
    },
  )

  ipcMain.handle('authorizedList:pickExcel', async (event) => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'בחירת קובץ רשימת מורשים Excel',
        properties: ['openFile'],
        filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
      })
      if (result.canceled || !result.filePaths[0]) {
        return { ok: false as const, canceled: true as const }
      }
      return { ok: true as const, path: result.filePaths[0] }
    } finally {
      refocusMainWindow(event.sender)
    }
  })

  ipcMain.handle(
    'authorizedList:createExcel',
    async (
      event,
      payload?: { defaultName?: string },
    ) => {
      try {
        const defaultName =
          typeof payload?.defaultName === 'string' && payload.defaultName.trim()
            ? payload.defaultName.trim()
            : 'רשימת מורשים.xlsx'
        const result = await dialog.showSaveDialog({
          title: 'יצירת קובץ רשימת מורשים Excel',
          defaultPath: defaultName,
          filters: [{ name: 'Excel', extensions: ['xlsx'] }],
        })
        if (result.canceled || !result.filePath) {
          return { ok: false as const, canceled: true as const }
        }
        const created = await createAuthorizedListTemplate(result.filePath)
        if (!created.ok) {
          return { ok: false as const, error: created.error }
        }
        return { ok: true as const, path: result.filePath }
      } finally {
        refocusMainWindow(event.sender)
      }
    },
  )

  ipcMain.handle(
    'authorizedList:readExcel',
    async (_event, filePath: string) =>
      readAuthorizedListExcel(String(filePath || '')),
  )

  ipcMain.handle(
    'authorizedList:writeExcel',
    async (
      _event,
      payload: {
        filePath: string
        people: Array<{
          id: string
          firstName: string
          lastName: string
          idNumber?: string
          kind?: 'permanent' | 'visitor' | string
          notes?: string
          updatedAt?: string
        }>
      },
    ) => {
      const rows = (payload.people ?? []).map((p) => {
        const kindRaw = String(p.kind ?? p.notes ?? '')
        const kind: 'permanent' | 'visitor' =
          kindRaw === 'visitor' ||
          kindRaw === 'וויזיטור' ||
          kindRaw === 'ויזיטור' ||
          kindRaw === 'ללא כרטיס'
            ? 'visitor'
            : 'permanent'
        return {
          id: p.id,
          firstName: p.firstName ?? '',
          lastName: p.lastName ?? '',
          idNumber: p.idNumber ?? '',
          kind,
          notes: p.notes ?? '',
          updatedAt: p.updatedAt ?? new Date().toISOString(),
        }
      })
      return writeAuthorizedListExcel(String(payload.filePath || ''), rows)
    },
  )

  ipcMain.handle(
    'authorizedList:mtime',
    async (_event, filePath: string) =>
      getAuthorizedListFileMtime(String(filePath || '')),
  )

  ipcMain.handle(
    'shiftReport:saveFiles',
    async (
      _event,
      payload: {
        folder: string
        relativeDir: string
        docxFileName: string
        jsonFileName: string
        json: string
        docxBytes: number[]
      },
    ) => {
      try {
        const dir = ensureShiftReportSaveDir(payload.folder, payload.relativeDir)
        fs.writeFileSync(
          path.join(dir, payload.jsonFileName),
          payload.json,
          'utf-8',
        )
        fs.writeFileSync(
          path.join(dir, payload.docxFileName),
          Buffer.from(payload.docxBytes),
        )
        return { ok: true as const }
      } catch (err) {
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : 'save_failed',
        }
      }
    },
  )

  ipcMain.handle(
    'shiftReport:deleteFiles',
    async (
      _event,
      payload: {
        folder: string
        relativeDir: string
        docxFileName: string
        jsonFileName: string
      },
    ) => {
      try {
        const dir = path.join(
          payload.folder,
          ...payload.relativeDir.split('/').filter(Boolean),
        )
        const docxPath = path.join(dir, payload.docxFileName)
        const jsonPath = path.join(dir, payload.jsonFileName)
        if (fs.existsSync(docxPath)) fs.unlinkSync(docxPath)
        if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath)
        return { ok: true as const }
      } catch (err) {
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : 'delete_failed',
        }
      }
    },
  )

  ipcMain.handle(
    'cameraReport:saveWorkbook',
    async (
      _event,
      payload: {
        folder: string
        relativeDir: string
        fileName: string
        year: number
        month: number
        archive: Record<string, Record<string, unknown>>
        currentReport: Record<string, unknown>
      },
    ) => {
      try {
        const dir = ensureShiftReportSaveDir(payload.folder, payload.relativeDir)
        const filePath = path.join(dir, payload.fileName)
        await writeCameraMonthlyWorkbook(filePath, {
          year: payload.year,
          month: payload.month,
          archive: payload.archive,
          currentReport: payload.currentReport,
        })
        return { ok: true as const }
      } catch (err) {
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : 'save_failed',
        }
      }
    },
  )

  ipcMain.handle(
    'shiftReport:testEmail',
    async (
      _event,
      payload: {
        directorEmail: string
        smtpHost: string
        smtpPort: number
        smtpUser: string
        smtpPass: string
      },
    ) => sendShiftReportTestEmail(payload),
  )

  ipcMain.handle(
    'shiftReport:sendEmail',
    async (
      _event,
      payload: {
        date: string
        directorEmail: string
        smtpHost: string
        smtpPort: number
        smtpUser: string
        smtpPass: string
        attachments: Array<{ name: string; bytes: number[] }>
      },
    ) => sendShiftReportsEmail(payload),
  )

  ipcMain.handle(
    'shiftReport:emailStatus',
    (_event, payload: { date: string }) =>
      shiftEmailStatus(String(payload?.date ?? '').trim()),
  )

  ipcMain.handle('shiftReport:emailSentLog', () => listShiftEmailSentLog())

  ipcMain.handle(
    'shiftReport:sendReportEmail',
    async (_event, payload: { date: string; force?: boolean }) =>
      sendShiftReportForDate(String(payload?.date ?? '').trim(), {
        force: Boolean(payload?.force),
      }),
  )

  ipcMain.handle(
    'cameraReport:monthlyEmailStatus',
    (_event, payload: { year: number; month: number }) =>
      cameraMonthlyEmailStatus(
        monthlyCameraReportKey(payload.year, payload.month),
      ),
  )

  ipcMain.handle(
    'cameraReport:sendMonthlyEmail',
    async (_event, payload: { year: number; month: number; force?: boolean }) =>
      sendCameraMonthlyForMonth(payload.year, payload.month, {
        force: Boolean(payload?.force),
      }),
  )

  let mainWindow: BrowserWindow | null = null

  ipcMain.handle('update:download', async () => {
    await autoUpdater.downloadUpdate()
    return true
  })

  ipcMain.handle('update:install', () => {
    setImmediate(() => autoUpdater.quitAndInstall(false, true))
    return true
  })

  ipcMain.handle('app:getVersion', () => app.getVersion())

  mainWindow = createWindow()
  setupAutoUpdater(() => mainWindow)
  // Au démarrage : rattraper un envoi manqué si l'heure prévue est déjà passée
  setTimeout(() => {
    trySendDailyShiftReports()
    trySendMonthlyCameraReports()
  }, 8_000)
  setInterval(trySendDailyShiftReports, 60_000)
  setInterval(trySendMonthlyCameraReports, 60_000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
