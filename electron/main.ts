import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  nativeImage,
  net,
  session,
  shell,
} from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
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

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function runWindowsPs1(script: string): Promise<string> {
  return new Promise((resolve) => {
    const scriptPath = path.join(
      os.tmpdir(),
      `liste-wa-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.ps1`,
    )
    try {
      fs.writeFileSync(scriptPath, script, 'utf8')
    } catch {
      resolve('')
      return
    }
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { windowsHide: true, timeout: 20000 },
      (err, stdout) => {
        try {
          fs.unlinkSync(scriptPath)
        } catch {
          /* ignore */
        }
        resolve(err ? '' : String(stdout || '').trim())
      },
    )
  })
}

function runWhatsAppKeys(keys: 'paste' | 'enter' | 'paste-enter'): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      // Windows: uniquement WhatsApp Web (navigateur) — jamais l'app Desktop/Beta.
      const mode =
        keys === 'paste' ? 'paste' : keys === 'enter' ? 'enter' : 'paste-enter'
      const script = `
$ErrorActionPreference = 'SilentlyContinue'
$Mode = '${mode}'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class WaKeys {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  const uint KEYEVENTF_KEYUP = 0x0002;
  const byte VK_CONTROL = 0x11;
  const byte VK_RETURN = 0x0D;
  const byte VK_V = 0x56;
  public static void Chord(byte mod, byte key) {
    keybd_event(mod, 0, 0, UIntPtr.Zero);
    keybd_event(key, 0, 0, UIntPtr.Zero);
    keybd_event(key, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    keybd_event(mod, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
  }
  public static void Paste() { Chord(VK_CONTROL, VK_V); }
  public static void CtrlEnter() { Chord(VK_CONTROL, VK_RETURN); }
  public static void Enter() {
    keybd_event(VK_RETURN, 0, 0, UIntPtr.Zero);
    keybd_event(VK_RETURN, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
  }
}
"@
$browsers = @('chrome','msedge','brave','firefox','opera','vivaldi','msedgewebview2')
$proc = $null
foreach ($b in $browsers) {
  $hit = Get-Process -Name $b -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle -match 'WhatsApp' -and $_.MainWindowHandle -ne 0 } |
    Select-Object -First 1
  if ($null -ne $hit) { $proc = $hit; break }
}
if ($null -eq $proc) { exit 0 }
[void][WaKeys]::ShowWindowAsync($proc.MainWindowHandle, 9)
[void][WaKeys]::SetForegroundWindow($proc.MainWindowHandle)
$wshell = New-Object -ComObject wscript.shell
[void]$wshell.AppActivate($proc.Id)
Start-Sleep -Milliseconds 350
if ($Mode -eq 'paste' -or $Mode -eq 'paste-enter') {
  [WaKeys]::Paste()
  Start-Sleep -Milliseconds 120
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  Start-Sleep -Milliseconds 280
}
if ($Mode -eq 'enter' -or $Mode -eq 'paste-enter') {
  # WhatsApp Web: Enter envoie souvent ; Ctrl+Enter en secours
  [WaKeys]::Enter()
  Start-Sleep -Milliseconds 120
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Start-Sleep -Milliseconds 140
  [WaKeys]::CtrlEnter()
  Start-Sleep -Milliseconds 120
  [System.Windows.Forms.SendKeys]::SendWait('^{ENTER}')
}
`
      void runWindowsPs1(script).then(() => resolve())
      return
    }

    if (process.platform === 'darwin') {
      const action =
        keys === 'paste'
          ? `keystroke "v" using command down`
          : keys === 'enter'
            ? `keystroke return using control down
          delay 0.2
          keystroke return`
            : `keystroke "v" using command down
          delay 0.25
          keystroke return using control down
          delay 0.12
          keystroke return
          delay 0.12
          keystroke return using control down`
      const script = `
        try
          tell application "WhatsApp Beta" to activate
        on error
          try
            tell application "WhatsApp" to activate
          end try
        end try
        delay 0.25
        tell application "System Events"
          ${action}
        end tell
      `
      execFile('osascript', ['-e', script], () => resolve())
      return
    }

    resolve()
  })
}

function scheduleWhatsAppPasteAndSend(delaysMs: number[]) {
  for (const ms of delaysMs) {
    setTimeout(() => {
      void runWhatsAppKeys('paste-enter')
    }, ms)
  }
}

function normalizeWhatsAppPhone(phone: string): string {
  let digits = String(phone || '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith('0')) digits = `972${digits.slice(1)}`
  return digits
}

type WhatsAppSendError =
  | 'offline'
  | 'whatsapp_unavailable'
  | 'whatsapp_not_connected'
  | 'failed'
type WhatsAppSendResult = { ok: boolean; error?: WhatsAppSendError }
type WhatsAppChannel = 'desktop' | 'web' | 'none'
type WhatsAppStatus = {
  online: boolean
  /** true si une session WhatsApp semble réellement connectée (app ou Web) */
  whatsappAvailable: boolean
  channel: WhatsAppChannel
  connected: boolean
  /** desktop installé/détecté même si pas connecté */
  desktopInstalled: boolean
  desktopRunning: boolean
  webOpen: boolean
  detail: string
}

type WhatsAppWebDomState = 'connected' | 'login' | 'loading' | 'error'

let whatsappWebWin: BrowserWindow | null = null
let isAppQuitting = false

/** WhatsApp Web refuse souvent Electron : se faire passer pour Chrome. */
const WHATSAPP_WEB_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

function isNetworkOnline(): boolean {
  try {
    return net.isOnline()
  } catch {
    return true
  }
}

function configureWhatsAppWebSession() {
  const ses = session.fromPartition('persist:whatsapp-web')
  ses.setUserAgent(WHATSAPP_WEB_USER_AGENT)
  return ses
}

function destroyWhatsAppWebWindow() {
  if (whatsappWebWin && !whatsappWebWin.isDestroyed()) {
    whatsappWebWin.destroy()
  }
  whatsappWebWin = null
}

function ensureWhatsAppWebWindow(show: boolean): BrowserWindow {
  configureWhatsAppWebSession()

  if (whatsappWebWin && !whatsappWebWin.isDestroyed()) {
    whatsappWebWin.webContents.setUserAgent(WHATSAPP_WEB_USER_AGENT)
    if (show) {
      whatsappWebWin.show()
      whatsappWebWin.focus()
    }
    return whatsappWebWin
  }

  const icon = resolveAppIcon()
  const preloadPath = path.join(__dirname, 'whatsapp-preload.js')
  whatsappWebWin = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: 'WhatsApp Web — Chevron',
    backgroundColor: '#111b21',
    ...(icon ? { icon } : {}),
    webPreferences: {
      // Session persistante = on peut vraiment savoir si Web est connecté
      partition: 'persist:whatsapp-web',
      ...(fs.existsSync(preloadPath) ? { preload: preloadPath } : {}),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  whatsappWebWin.webContents.setUserAgent(WHATSAPP_WEB_USER_AGENT)

  whatsappWebWin.on('close', (event) => {
    // Garder la session en vie (fenêtre cachée) pour le statut de connexion
    if (!isAppQuitting) {
      event.preventDefault()
      whatsappWebWin?.hide()
    }
  })

  void whatsappWebWin.loadURL('https://web.whatsapp.com/', {
    userAgent: WHATSAPP_WEB_USER_AGENT,
  })
  if (show) {
    whatsappWebWin.once('ready-to-show', () => {
      whatsappWebWin?.show()
    })
  }
  return whatsappWebWin
}

async function waitForWebContentsIdle(
  win: BrowserWindow,
  timeoutMs = 12000,
): Promise<void> {
  if (win.isDestroyed()) return
  if (!win.webContents.isLoading()) {
    await wait(400)
    return
  }
  await Promise.race([
    new Promise<void>((resolve) => {
      win.webContents.once('did-finish-load', () => resolve())
    }),
    wait(timeoutMs),
  ])
}

async function inspectWhatsAppWebDom(
  win: BrowserWindow,
): Promise<WhatsAppWebDomState> {
  if (win.isDestroyed()) return 'error'
  try {
    await waitForWebContentsIdle(win)
    const state = (await win.webContents.executeJavaScript(
      `(() => {
        const qr = document.querySelector(
          '[data-testid="qrcode"], canvas[aria-label*="QR"], canvas[aria-label*="qr"], div[data-ref]'
        );
        const side = document.querySelector(
          '#pane-side, [data-testid="chat-list"], #side, [aria-label*="Chat list"], [aria-label*="רשימת הצ׳אטים"]'
        );
        const compose = document.querySelector(
          '[data-testid="conversation-compose-box-input"], footer div[contenteditable="true"]'
        );
        const text = (document.body && document.body.innerText || '').slice(0, 2500);
        const loginText = /QR code|Link with phone|Link a device|קישור למכשיר|סרוק את הקוד|Log in|התחברות/i.test(text);
        if (side || compose) return 'connected';
        if (qr || loginText) return 'login';
        return 'loading';
      })()`,
      true,
    )) as WhatsAppWebDomState
    if (
      state === 'connected' ||
      state === 'login' ||
      state === 'loading' ||
      state === 'error'
    ) {
      return state
    }
    return 'loading'
  } catch {
    return 'error'
  }
}

async function openWhatsAppWebSessionWindow(): Promise<WhatsAppStatus> {
  const win = ensureWhatsAppWebWindow(true)
  win.webContents.setUserAgent(WHATSAPP_WEB_USER_AGENT)
  // Recharger avec UA Chrome (évite l'écran "Télécharger Chrome")
  await win.loadURL('https://web.whatsapp.com/', {
    userAgent: WHATSAPP_WEB_USER_AGENT,
  })
  await waitForWebContentsIdle(win, 15000)
  // Laisser le QR / l'UI se dessiner
  await wait(1200)
  return getWhatsAppStatus()
}

async function probeWindowsWhatsAppWeb(): Promise<
  Omit<WhatsAppStatus, 'online'>
> {
  try {
    const win = ensureWhatsAppWebWindow(false)
    if (!win.webContents.getURL().includes('web.whatsapp.com')) {
      await win.loadURL('https://web.whatsapp.com/', {
        userAgent: WHATSAPP_WEB_USER_AGENT,
      })
    }
    let state = await inspectWhatsAppWebDom(win)
    if (state === 'loading') {
      await wait(2000)
      state = await inspectWhatsAppWebDom(win)
    }
    if (state === 'connected') {
      return {
        whatsappAvailable: true,
        channel: 'web',
        connected: true,
        desktopInstalled: false,
        desktopRunning: false,
        webOpen: true,
        detail: 'web_connected',
      }
    }
    if (state === 'login') {
      return {
        whatsappAvailable: false,
        channel: 'web',
        connected: false,
        desktopInstalled: false,
        desktopRunning: false,
        webOpen: true,
        detail: 'web_login',
      }
    }
    return {
      whatsappAvailable: false,
      channel: 'web',
      connected: false,
      desktopInstalled: false,
      desktopRunning: false,
      webOpen: true,
      detail: state === 'error' ? 'probe_failed' : 'web_loading',
    }
  } catch {
    return {
      whatsappAvailable: false,
      channel: 'web',
      connected: false,
      desktopInstalled: false,
      desktopRunning: false,
      webOpen: false,
      detail: 'probe_failed',
    }
  }
}

async function sendViaEmbeddedWhatsAppWeb(
  phoneNorm: string,
  text: string,
): Promise<WhatsAppSendResult> {
  clipboard.writeText(text)
  const status = await probeWindowsWhatsAppWeb()
  if (!status.connected) {
    ensureWhatsAppWebWindow(true)
    return { ok: false, error: 'whatsapp_not_connected' }
  }

  const win = ensureWhatsAppWebWindow(true)
  const shortEnough = text.length <= 1200
  const encoded = shortEnough ? encodeURIComponent(text) : ''
  const url = encoded
    ? `https://web.whatsapp.com/send?phone=${phoneNorm}&text=${encoded}`
    : `https://web.whatsapp.com/send?phone=${phoneNorm}`

  await win.loadURL(url, { userAgent: WHATSAPP_WEB_USER_AGENT })
  await waitForWebContentsIdle(win, 15000)
  await wait(250)

  // Une seule passe DOM : attendre le champ, remplir si besoin, cliquer Send aussitôt
  // (évite le délai lent collage → Entrée via SendInput)
  const sent = await win.webContents.executeJavaScript(
    `(() => new Promise((resolve) => {
      const message = ${JSON.stringify(text)}
      const alreadyFilled = ${encoded ? 'true' : 'false'}
      let tries = 0

      const findInput = () =>
        document.querySelector(
          '[data-testid="conversation-compose-box-input"], footer div[contenteditable="true"]'
        )

      const findSend = () => {
        const byTestId = document.querySelector('[data-testid="send"]')
        if (byTestId) return byTestId
        const byIcon = document.querySelector('span[data-icon="send"]')
        if (byIcon) return byIcon.closest('button') || byIcon.parentElement
        const buttons = Array.from(document.querySelectorAll('button,[role="button"]'))
        return buttons.find((b) => {
          const label = (b.getAttribute('aria-label') || b.textContent || '').toLowerCase()
          return (
            label.includes('send') ||
            label.includes('שליחה') ||
            label.includes('envoyer')
          )
        }) || null
      }

      const clickSend = (input) => {
        const sendBtn = findSend()
        if (sendBtn) {
          sendBtn.click()
          return true
        }
        const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }
        input.dispatchEvent(new KeyboardEvent('keydown', opts))
        input.dispatchEvent(new KeyboardEvent('keypress', opts))
        input.dispatchEvent(new KeyboardEvent('keyup', opts))
        return true
      }

      const tick = () => {
        tries += 1
        const okBtn = document.querySelector(
          '[data-testid="popup-controls-ok"], button[data-testid="popup-controls-ok"]'
        )
        if (okBtn) okBtn.click()

        const input = findInput()
        if (!input) {
          if (tries >= 50) {
            resolve(false)
            return
          }
          setTimeout(tick, 80)
          return
        }

        input.focus()
        if (!alreadyFilled) {
          try {
            document.execCommand('selectAll', false)
            document.execCommand('insertText', false, message)
          } catch (_) {
            input.textContent = message
            input.dispatchEvent(new InputEvent('input', { bubbles: true }))
          }
        }

        // Envoi immédiat après remplissage (pas d'attente artificielle)
        clickSend(input)
        setTimeout(() => clickSend(input), 60)
        resolve(true)
      }
      tick()
    }))()`,
    true,
  )

  if (!sent) {
    // Secours minimal : collage natif + Entrée sans longues pauses
    win.webContents.paste()
    await wait(80)
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
    await wait(80)
    return { ok: true }
  }

  await wait(120)
  return { ok: true }
}

async function probeWhatsAppConnection(): Promise<
  Omit<WhatsAppStatus, 'online'>
> {
  if (process.platform === 'win32') {
    // Windows: session WhatsApp Web embarquée (vérifiable via le DOM)
    return probeWindowsWhatsAppWeb()
  }

  if (process.platform === 'darwin') {
    const installed = await new Promise<boolean>((resolve) => {
      execFile(
        'osascript',
        [
          '-e',
          'try\n id of application "WhatsApp"\non error\n id of application "WhatsApp Beta"\nend try',
        ],
        (err) => resolve(!err),
      )
    })
    const running = await new Promise<boolean>((resolve) => {
      execFile(
        'osascript',
        [
          '-e',
          'tell application "System Events" to (name of processes) contains "WhatsApp" or (name of processes) contains "WhatsApp Beta"',
        ],
        (err, stdout) => resolve(!err && String(stdout).trim() === 'true'),
      )
    })
    const webOpen = await new Promise<boolean>((resolve) => {
      execFile(
        'osascript',
        [
          '-e',
          'tell application "System Events" to (exists (processes whose name is "Google Chrome" or name is "Safari" or name is "Microsoft Edge" or name is "Brave Browser" or name is "Firefox"))',
        ],
        () => {
          execFile(
            'osascript',
            [
              '-e',
              `
set found to false
tell application "System Events"
  repeat with p in (every process whose background only is false)
    try
      repeat with w in windows of p
        try
          if name of w contains "WhatsApp" then set found to true
        end try
      end repeat
    end try
  end repeat
end tell
return found
`,
            ],
            (err, stdout) => resolve(!err && String(stdout).trim() === 'true'),
          )
        },
      )
    })

    // Sur Mac, si l'app tourne on considère connectée (probe UI limité)
    const connected = running || webOpen
    const channel: WhatsAppChannel = running
      ? 'desktop'
      : webOpen
        ? 'web'
        : installed
          ? 'desktop'
          : 'none'
    return {
      whatsappAvailable: connected,
      channel,
      connected,
      desktopInstalled: installed,
      desktopRunning: running,
      webOpen,
      detail: running
        ? 'desktop_connected'
        : webOpen
          ? 'web_connected'
          : installed
            ? 'desktop_not_running'
            : 'not_installed',
    }
  }

  return {
    whatsappAvailable: true,
    channel: 'desktop',
    connected: true,
    desktopInstalled: true,
    desktopRunning: true,
    webOpen: false,
    detail: 'unknown',
  }
}

async function getWhatsAppStatus(): Promise<WhatsAppStatus> {
  const online = isNetworkOnline()
  const probe = await probeWhatsAppConnection()
  return { online, ...probe }
}

async function openWhatsAppAndPaste() {
  // Un "." ouvre l'écran "à qui envoyer" ; l'image reste dans le presse-papiers
  const text = encodeURIComponent('.')
  if (process.platform === 'win32') {
    const win = ensureWhatsAppWebWindow(true)
    await win.loadURL(`https://web.whatsapp.com/send?text=${text}`, {
      userAgent: WHATSAPP_WEB_USER_AGENT,
    })
    await wait(1800)
    win.webContents.paste()
    await wait(180)
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
    return
  }
  try {
    await shell.openExternal(`whatsapp://send?text=${text}`)
  } catch {
    await shell.openExternal(`https://web.whatsapp.com/send?text=${text}`)
  }
  // Collage + envoi auto après choix du contact / ouverture
  scheduleWhatsAppPasteAndSend([2000, 3800, 5500])
}

async function openWhatsAppSendText(
  phone: string,
  text: string,
): Promise<WhatsAppSendResult> {
  const phoneNorm = normalizeWhatsAppPhone(phone)
  if (!phoneNorm || !text.trim()) return { ok: false, error: 'failed' }

  if (!isNetworkOnline()) {
    clipboard.writeText(text)
    return { ok: false, error: 'offline' }
  }

  // Windows: WhatsApp Web embarqué (statut DOM réel + envoi dans la même session)
  if (process.platform === 'win32') {
    return sendViaEmbeddedWhatsAppWeb(phoneNorm, text)
  }

  const status = await getWhatsAppStatus()
  if (!status.connected) {
    clipboard.writeText(text)
    if (!status.desktopInstalled && !status.webOpen) {
      return { ok: false, error: 'whatsapp_unavailable' }
    }
    return { ok: false, error: 'whatsapp_not_connected' }
  }

  clipboard.writeText(text)

  const shortEnough = text.length <= 1200
  const encoded = shortEnough ? encodeURIComponent(text) : ''
  const desktopUri = encoded
    ? `whatsapp://send?phone=${phoneNorm}&text=${encoded}`
    : `whatsapp://send?phone=${phoneNorm}`
  const webUri = encoded
    ? `https://web.whatsapp.com/send?phone=${phoneNorm}&text=${encoded}`
    : `https://web.whatsapp.com/send?phone=${phoneNorm}`

  try {
    if (status.channel === 'web' && !status.desktopRunning) {
      await shell.openExternal(webUri)
    } else {
      try {
        await shell.openExternal(desktopUri)
      } catch {
        await shell.openExternal(webUri)
      }
    }
  } catch {
    return { ok: false, error: 'whatsapp_unavailable' }
  }

  await wait(status.channel === 'web' ? 3200 : 2600)
  if (encoded) {
    await runWhatsAppKeys('enter')
  } else {
    await runWhatsAppKeys('paste-enter')
  }
  await wait(350)
  await runWhatsAppKeys('enter')
  await wait(250)
  return { ok: true }
}

async function openWhatsAppSendTextMany(
  phones: string[],
  text: string,
): Promise<WhatsAppSendResult> {
  const unique = Array.from(
    new Set(
      phones
        .map((p) => normalizeWhatsAppPhone(p))
        .filter(Boolean),
    ),
  )
  if (unique.length === 0) return { ok: false, error: 'failed' }

  if (!isNetworkOnline()) {
    clipboard.writeText(text)
    return { ok: false, error: 'offline' }
  }

  if (process.platform === 'win32') {
    for (const phone of unique) {
      const result = await sendViaEmbeddedWhatsAppWeb(phone, text)
      if (!result.ok) return result
    }
    return { ok: true }
  }

  const status = await getWhatsAppStatus()
  if (!status.connected) {
    clipboard.writeText(text)
    if (!status.desktopInstalled && !status.webOpen) {
      return { ok: false, error: 'whatsapp_unavailable' }
    }
    return { ok: false, error: 'whatsapp_not_connected' }
  }

  for (const phone of unique) {
    const result = await openWhatsAppSendText(phone, text)
    if (!result.ok) return result
  }
  return { ok: true }
}

function resolveAppIcon(): string | undefined {
  const candidates = [
    path.join(__dirname, '../build/icon.ico'),
    path.join(__dirname, '../build/icon.png'),
    path.join(process.resourcesPath, 'build/icon.ico'),
    path.join(process.resourcesPath, 'icon.ico'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return undefined
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
    // La fenêtre WhatsApp Web cachée empêcherait sinon la fermeture de l'app
    if (process.platform !== 'darwin') {
      isAppQuitting = true
      destroyWhatsAppWebWindow()
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
    writeData(normalize(data))
    return true
  })

  ipcMain.handle('whatsapp:open', async () => {
    await openWhatsAppAndPaste()
    return true
  })

  ipcMain.handle('whatsapp:status', async () => getWhatsAppStatus())

  ipcMain.handle('whatsapp:openWebSession', async () => {
    return openWhatsAppWebSessionWindow()
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

  // Précharger WhatsApp Web en arrière-plan (Windows) pour un statut fiable
  if (process.platform === 'win32') {
    configureWhatsAppWebSession()
    setTimeout(() => {
      try {
        ensureWhatsAppWebWindow(false)
      } catch {
        /* ignore */
      }
    }, 2500)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

app.on('before-quit', () => {
  isAppQuitting = true
  destroyWhatsAppWebWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
