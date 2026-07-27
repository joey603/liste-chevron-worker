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

  const settings = {
    ...defaultData().settings,
    ...raw.settings,
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
}

app.whenReady().then(() => {
  ipcMain.handle('data:get', () => readData())

  ipcMain.handle('data:save', (_event, data: AppData) => {
    writeData(normalize(data))
    return true
  })

  ipcMain.handle('whatsapp:open', async () => {
    await shell.openExternal('https://web.whatsapp.com/')
    return true
  })

  ipcMain.handle('clipboard:writeImage', (_event, dataUrl: string) => {
    const image = nativeImage.createFromDataURL(dataUrl)
    clipboard.writeImage(image)
    return true
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
