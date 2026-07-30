import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  nativeImage,
  shell,
} from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { execFile } from 'node:child_process'
import { autoUpdater } from 'electron-updater'

type EntryKind = 'named' | 'visitor'

type Worker = {
  id: string
  firstName: string
  lastName: string
  temporary: boolean
  expiresAt: string | null
}

type PersonEntry = {
  id: string
  kind: EntryKind
  workerId: string | null
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

type AppSettings = {
  directorPhone: string
  emergencyPhones: string[]
  siteName: string
  visitorSlots: Record<string, VisitorSlot>
}

type AppData = {
  settings: AppSettings
  workers: Worker[]
  people: PersonEntry[]
  banned: BannedPerson[]
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
  people: [],
  banned: [],
})

function dataPath() {
  return path.join(app.getPath('userData'), 'liste-data.json')
}

function normalizeEmergencyPhones(
  raw: unknown,
  directorPhone = '',
): string[] {
  const list: string[] = []
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item !== 'string') continue
      const trimmed = item.trim()
      if (!trimmed) continue
      list.push(trimmed)
    }
  } else if (directorPhone.trim()) {
    list.push(directorPhone.trim())
  }
  const seen = new Set<string>()
  const unique: string[] = []
  for (const phone of list) {
    const key = phone.replace(/\D/g, '')
    if (!key || seen.has(key)) continue
    seen.add(key)
    unique.push(phone)
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

  const emergencyPhones = normalizeEmergencyPhones(
    raw.settings?.emergencyPhones,
    raw.settings?.directorPhone ?? '',
  )

  const settings = {
    ...defaultData().settings,
    ...raw.settings,
    emergencyPhones,
    directorPhone: emergencyPhones[0] ?? '',
    visitorSlots: normalizeVisitorSlots(raw.settings?.visitorSlots, now),
  }

  return {
    settings,
    workers,
    people: Array.isArray(raw.people)
      ? raw.people.map((p) => ({
          ...p,
          workerId: p.workerId ?? null,
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
  }
}

function readData(): AppData {
  const file = dataPath()
  try {
    if (!fs.existsSync(file)) {
      const data = defaultData()
      fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
      return data
    }
    const raw = fs.readFileSync(file, 'utf-8')
    return normalize(JSON.parse(raw) as Partial<AppData>)
  } catch {
    return defaultData()
  }
}

function writeData(data: AppData) {
  fs.writeFileSync(dataPath(), JSON.stringify(data, null, 2), 'utf-8')
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

  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) {
      return { status: 'up-to-date' as const, version: app.getVersion() }
    }
    if (pendingUpdate) {
      sendToWindows('update:available', pendingUpdate)
      return { status: 'available' as const, ...pendingUpdate }
    }
    lastUpdateError = null
    await check()
    if (pendingUpdate) {
      return { status: 'available' as const, ...pendingUpdate }
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
  setInterval(() => void check(), 15 * 60 * 1000)
}

function scheduleWhatsAppPaste(delaysMs: number[]) {
  if (process.platform === 'win32') {
    const activations = delaysMs
      .map(
        (ms) => `
Start-Sleep -Milliseconds ${ms}
try {
  $wshell = New-Object -ComObject wscript.shell
  $null = $wshell.AppActivate('WhatsApp')
  Start-Sleep -Milliseconds 250
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.SendKeys]::SendWait('^v')
} catch {}
`,
      )
      .join('\n')
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', activations],
      { windowsHide: true },
      () => undefined,
    )
    return
  }

  if (process.platform === 'darwin') {
    for (const ms of delaysMs) {
      const script = `
        delay ${Math.max(0.2, ms / 1000)}
        tell application "System Events"
          keystroke "v" using command down
        end tell
      `
      execFile('osascript', ['-e', script], () => undefined)
    }
  }
}

function scheduleWhatsAppEnter(delaysMs: number[]) {
  if (process.platform === 'win32') {
    const activations = delaysMs
      .map(
        (ms) => `
Start-Sleep -Milliseconds ${ms}
try {
  $wshell = New-Object -ComObject wscript.shell
  $null = $wshell.AppActivate('WhatsApp')
  Start-Sleep -Milliseconds 350
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
} catch {}
`,
      )
      .join('\n')
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', activations],
      { windowsHide: true },
      () => undefined,
    )
    return
  }

  if (process.platform === 'darwin') {
    for (const ms of delaysMs) {
      const script = `
        delay ${Math.max(0.2, ms / 1000)}
        try
          tell application "WhatsApp" to activate
        end try
        delay 0.35
        tell application "System Events"
          keystroke return
        end tell
      `
      execFile('osascript', ['-e', script], () => undefined)
    }
  }
}

function normalizeWhatsAppPhone(phone: string): string {
  let digits = String(phone || '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith('0')) digits = `972${digits.slice(1)}`
  return digits
}

async function openWhatsAppAndPaste() {
  // Un "." ouvre l'écran "à qui envoyer" ; l'image reste dans le presse-papiers
  const text = encodeURIComponent('.')
  try {
    await shell.openExternal(`whatsapp://send?text=${text}`)
  } catch {
    await shell.openExternal(`https://web.whatsapp.com/send?text=${text}`)
  }
  // Collage auto après choix du contact / ouverture
  scheduleWhatsAppPaste([3000, 5500, 8500])
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function pressWhatsAppEnterOnce(): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      const script = `
try {
  $wshell = New-Object -ComObject wscript.shell
  $null = $wshell.AppActivate('WhatsApp')
  Start-Sleep -Milliseconds 350
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
} catch {}
`
      execFile(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { windowsHide: true },
        () => resolve(),
      )
      return
    }

    if (process.platform === 'darwin') {
      const script = `
        try
          tell application "WhatsApp" to activate
        end try
        delay 0.35
        tell application "System Events"
          keystroke return
        end tell
      `
      execFile('osascript', ['-e', script], () => resolve())
      return
    }

    resolve()
  })
}

async function openWhatsAppSendText(phone: string, text: string) {
  const phoneNorm = normalizeWhatsAppPhone(phone)
  if (!phoneNorm) return false
  const encoded = encodeURIComponent(text)
  try {
    await shell.openExternal(
      `whatsapp://send?phone=${phoneNorm}&text=${encoded}`,
    )
  } catch {
    await shell.openExternal(`https://wa.me/${phoneNorm}?text=${encoded}`)
  }
  await wait(4000)
  await pressWhatsAppEnterOnce()
  await wait(1200)
  return true
}

async function openWhatsAppSendTextMany(phones: string[], text: string) {
  const unique = Array.from(
    new Set(
      phones
        .map((p) => normalizeWhatsAppPhone(p))
        .filter(Boolean),
    ),
  )
  if (unique.length === 0) return false
  for (const phone of unique) {
    await openWhatsAppSendText(phone, text)
  }
  return true
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1000,
    minHeight: 700,
    title: 'רשימת Chevron',
    backgroundColor: '#eef3f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  ipcMain.handle('data:get', () => readData())

  ipcMain.handle('data:save', (_event, data: AppData) => {
    writeData(normalize(data))
    return true
  })

  ipcMain.handle('whatsapp:open', async () => {
    await openWhatsAppAndPaste()
    return true
  })

  ipcMain.handle(
    'whatsapp:sendText',
    async (_event, phone: string | string[], text: string) => {
      const phones = Array.isArray(phone) ? phone : [phone]
      return openWhatsAppSendTextMany(
        phones.map((p) => String(p || '')),
        String(text || ''),
      )
    },
  )

  ipcMain.handle('clipboard:writeImage', (_event, dataUrl: string) => {
    const image = nativeImage.createFromDataURL(dataUrl)
    clipboard.writeImage(image)
    return true
  })

  ipcMain.handle(
    'whatsapp:shareImage',
    async (_event, dataUrl: string) => {
      const image = nativeImage.createFromDataURL(dataUrl)
      if (image.isEmpty()) return false
      clipboard.writeImage(image)
      await openWhatsAppAndPaste()
      return true
    },
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
