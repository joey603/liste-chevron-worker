import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  nativeImage,
  net,
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
      // Windows: pas de clics aléatoires (comportement bizarre sur Beta).
      // Collage + Ctrl+Entrée uniquement (Entrée = souvent nouvelle ligne).
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
}
"@
$proc = Get-Process |
  Where-Object { $_.ProcessName -match 'WhatsApp' -and $_.MainWindowHandle -ne 0 } |
  Sort-Object {
    if ($_.MainWindowTitle -match 'Beta') { 0 }
    elseif ($_.ProcessName -match 'Beta') { 1 }
    else { 2 }
  } |
  Select-Object -First 1
if ($null -eq $proc) { exit 0 }
[void][WaKeys]::ShowWindowAsync($proc.MainWindowHandle, 9)
[void][WaKeys]::SetForegroundWindow($proc.MainWindowHandle)
$wshell = New-Object -ComObject wscript.shell
[void]$wshell.AppActivate($proc.Id)
Start-Sleep -Milliseconds 600
if ($Mode -eq 'paste' -or $Mode -eq 'paste-enter') {
  [WaKeys]::Paste()
  Start-Sleep -Milliseconds 250
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  Start-Sleep -Milliseconds 800
}
if ($Mode -eq 'enter' -or $Mode -eq 'paste-enter') {
  # Ctrl+Enter = envoi typique quand Enter = nouvelle ligne (WhatsApp Desktop/Beta)
  [WaKeys]::CtrlEnter()
  Start-Sleep -Milliseconds 280
  [System.Windows.Forms.SendKeys]::SendWait('^{ENTER}')
  Start-Sleep -Milliseconds 400
  [WaKeys]::CtrlEnter()
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
          delay 0.7
          keystroke return using control down
          delay 0.25
          keystroke return
          delay 0.25
          keystroke return using control down`
      const script = `
        try
          tell application "WhatsApp Beta" to activate
        on error
          try
            tell application "WhatsApp" to activate
          end try
        end try
        delay 0.45
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

function isNetworkOnline(): boolean {
  try {
    return net.isOnline()
  } catch {
    return true
  }
}

async function probeWhatsAppConnection(): Promise<
  Omit<WhatsAppStatus, 'online'>
> {
  if (process.platform === 'win32') {
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$desktopInstalled = $false
$desktopRunning = $false
$desktopConnected = $false
$webOpen = $false
$channel = 'none'
$detail = 'none'

try {
  if (Get-AppxPackage -Name '*WhatsApp*' -ErrorAction SilentlyContinue) { $desktopInstalled = $true }
} catch {}
$paths = @(
  "$env:LOCALAPPDATA\\WhatsApp\\WhatsApp.exe",
  "$env:LOCALAPPDATA\\Programs\\WhatsApp\\WhatsApp.exe",
  "$env:LOCALAPPDATA\\WhatsAppBeta\\WhatsApp.exe",
  "$env:LOCALAPPDATA\\WhatsAppBeta\\WhatsApp Beta.exe",
  "$env:LOCALAPPDATA\\Programs\\WhatsAppBeta\\WhatsApp.exe"
)
foreach ($p in $paths) { if (Test-Path -LiteralPath $p) { $desktopInstalled = $true } }
foreach ($root in @('HKCU','HKLM')) {
  foreach ($proto in @('whatsapp','whatsapp-beta')) {
    try {
      $k = Get-ItemProperty -Path ($root + ':\\Software\\Classes\\' + $proto + '\\shell\\open\\command') -ErrorAction SilentlyContinue
      if ($null -ne $k) { $desktopInstalled = $true }
    } catch {}
  }
}

$waProcs = @(Get-Process | Where-Object { $_.ProcessName -match 'WhatsApp' -and $_.MainWindowHandle -ne 0 })
if ($waProcs.Count -gt 0) {
  $desktopInstalled = $true
  $desktopRunning = $true
  $proc = $waProcs | Sort-Object {
    if ($_.MainWindowTitle -match 'Beta') { 0 } else { 1 }
  } | Select-Object -First 1
  try {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
    if ($null -ne $root) {
      $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
      $texts = New-Object System.Collections.Generic.List[string]
      $stack = New-Object System.Collections.Generic.Stack[System.Windows.Automation.AutomationElement]
      $stack.Push($root)
      $n = 0
      while ($stack.Count -gt 0 -and $n -lt 250) {
        $el = $stack.Pop()
        $n++
        try {
          $name = [string]$el.Current.Name
          if (-not [string]::IsNullOrWhiteSpace($name)) { [void]$texts.Add($name) }
        } catch {}
        try {
          $child = $walker.GetFirstChild($el)
          while ($null -ne $child) {
            $stack.Push($child)
            $child = $walker.GetNextSibling($child)
          }
        } catch {}
      }
      $blob = ($texts -join ' | ')
      $login = $blob -match 'QR|קוד QR|Link with phone number|Link a device|קישור למכשיר|Scan this|סרוק|Log in|התחברות'
      $ready = $blob -match "Type a message|הקלד הודעה|Search|חיפוש|Chats|צ'אטים|Chat list|Message|הודעה|Send|שליחה"
      if ($login -and -not $ready) {
        $desktopConnected = $false
        $detail = 'desktop_login'
      } elseif ($ready -or (-not $login)) {
        # Fenêtre ouverte sans écran QR clair => considérée connectée
        $desktopConnected = $true
        $detail = 'desktop_connected'
      }
    } else {
      $desktopConnected = $true
      $detail = 'desktop_running'
    }
  } catch {
    $desktopConnected = $true
    $detail = 'desktop_running'
  }
}

$browsers = @('chrome','msedge','brave','firefox','opera','vivaldi')
foreach ($b in $browsers) {
  $hits = @(Get-Process -Name $b -ErrorAction SilentlyContinue | Where-Object {
    $_.MainWindowTitle -match 'WhatsApp'
  })
  if ($hits.Count -gt 0) {
    $webOpen = $true
    $titles = ($hits | ForEach-Object { $_.MainWindowTitle }) -join ' | '
    if ($titles -match 'QR|קוד QR|Log in|התחברות') {
      if ($detail -eq 'none') { $detail = 'web_login' }
    } else {
      if (-not $desktopConnected) {
        $detail = 'web_connected'
      }
    }
    break
  }
}

$connected = $false
if ($desktopConnected) {
  $connected = $true
  $channel = 'desktop'
  if ($detail -eq 'none' -or $detail -eq 'desktop_running') { $detail = 'desktop_connected' }
} elseif ($webOpen -and $detail -eq 'web_connected') {
  $connected = $true
  $channel = 'web'
} elseif ($webOpen -and $detail -eq 'web_login') {
  $channel = 'web'
} elseif ($desktopRunning) {
  $channel = 'desktop'
  if ($detail -eq 'none') { $detail = 'desktop_login' }
} elseif ($desktopInstalled) {
  $channel = 'desktop'
  $detail = 'desktop_not_running'
} else {
  $channel = 'none'
  $detail = 'not_installed'
}

Write-Output (@{
  desktopInstalled = $desktopInstalled
  desktopRunning = $desktopRunning
  webOpen = $webOpen
  connected = $connected
  channel = $channel
  detail = $detail
} | ConvertTo-Json -Compress)
`
    const raw = await runWindowsPs1(script)
    try {
      const parsed = JSON.parse(raw) as {
        desktopInstalled?: boolean
        desktopRunning?: boolean
        webOpen?: boolean
        connected?: boolean
        channel?: WhatsAppChannel
        detail?: string
      }
      const connected = Boolean(parsed.connected)
      return {
        whatsappAvailable: connected,
        channel: parsed.channel || 'none',
        connected,
        desktopInstalled: Boolean(parsed.desktopInstalled),
        desktopRunning: Boolean(parsed.desktopRunning),
        webOpen: Boolean(parsed.webOpen),
        detail: String(parsed.detail || 'none'),
      }
    } catch {
      return {
        whatsappAvailable: false,
        channel: 'none',
        connected: false,
        desktopInstalled: false,
        desktopRunning: false,
        webOpen: false,
        detail: 'probe_failed',
      }
    }
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
  try {
    await shell.openExternal(`whatsapp://send?text=${text}`)
  } catch {
    await shell.openExternal(`https://web.whatsapp.com/send?text=${text}`)
  }
  // Collage + envoi auto après choix du contact / ouverture
  scheduleWhatsAppPasteAndSend([3000, 5500, 8500])
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

  const status = await getWhatsAppStatus()
  if (!status.connected) {
    clipboard.writeText(text)
    if (!status.desktopInstalled && !status.webOpen) {
      return { ok: false, error: 'whatsapp_unavailable' }
    }
    return { ok: false, error: 'whatsapp_not_connected' }
  }

  // Presse-papiers = source fiable (évite les limites d'URL WhatsApp)
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

  // Attendre l'ouverture du chat puis coller / envoyer (Ctrl+Entrée sur Windows)
  await wait(status.channel === 'web' ? 5500 : 4200)
  if (encoded) {
    // Le texte est déjà dans le champ : envoi seulement
    await runWhatsAppKeys('enter')
  } else {
    await runWhatsAppKeys('paste-enter')
  }
  await wait(900)
  await runWhatsAppKeys('enter')
  await wait(800)
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
