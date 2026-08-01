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

function runWhatsAppKeys(keys: 'paste' | 'enter' | 'paste-enter'): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      // WhatsApp Beta: Entrée = souvent nouvelle ligne. On force l'envoi via
      // UI Automation (bouton Send/שליחה) + clic souris (LTR/RTL) + Ctrl+Entrée.
      const mode =
        keys === 'paste' ? 'paste' : keys === 'enter' ? 'enter' : 'paste-enter'
      const script = `
$ErrorActionPreference = 'SilentlyContinue'
$Mode = '${mode}'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class WaInput {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  const uint MOUSEEVENTF_LEFTUP = 0x0004;
  const uint KEYEVENTF_KEYUP = 0x0002;
  const byte VK_CONTROL = 0x11;
  const byte VK_RETURN = 0x0D;
  const byte VK_V = 0x56;
  const byte VK_A = 0x41;
  public static void ForceForeground(IntPtr hWnd) {
    uint unused;
    uint foreTid = GetWindowThreadProcessId(GetForegroundWindow(), out unused);
    uint appTid = GetWindowThreadProcessId(hWnd, out unused);
    uint curTid = GetCurrentThreadId();
    AttachThreadInput(curTid, foreTid, true);
    AttachThreadInput(curTid, appTid, true);
    ShowWindowAsync(hWnd, 9);
    SetForegroundWindow(hWnd);
    AttachThreadInput(curTid, foreTid, false);
    AttachThreadInput(curTid, appTid, false);
  }
  public static void Click(int x, int y) {
    SetCursorPos(x, y);
    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
  }
  public static void Chord(byte mod, byte key) {
    keybd_event(mod, 0, 0, UIntPtr.Zero);
    keybd_event(key, 0, 0, UIntPtr.Zero);
    keybd_event(key, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    keybd_event(mod, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
  }
  public static void Key(byte key) {
    keybd_event(key, 0, 0, UIntPtr.Zero);
    keybd_event(key, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
  }
  public static void Paste() { Chord(VK_CONTROL, VK_V); }
  public static void SelectAll() { Chord(VK_CONTROL, VK_A); }
  public static void Enter() { Key(VK_RETURN); }
  public static void CtrlEnter() { Chord(VK_CONTROL, VK_RETURN); }
}
"@

function Get-WhatsAppWindow {
  Get-Process |
    Where-Object { $_.ProcessName -match 'WhatsApp' -and $_.MainWindowHandle -ne 0 } |
    Sort-Object {
      if ($_.MainWindowTitle -match 'Beta') { 0 }
      elseif ($_.ProcessName -match 'Beta') { 1 }
      else { 2 }
    } |
    Select-Object -First 1
}

function Invoke-SendButton([IntPtr]$hwnd) {
  try {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
    if ($null -eq $root) { return $false }
    $btnType = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Button
    )
    $buttons = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $btnType)
    foreach ($btn in $buttons) {
      $name = [string]$btn.Current.Name
      if ($name -match 'Send|שליחה|Envoyer|Enviar|Invia|Senden') {
        $pattern = $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $pattern.Invoke()
        return $true
      }
    }
  } catch {}
  return $false
}

function Click-SendZones([IntPtr]$hwnd) {
  $rect = New-Object WaInput+RECT
  if (-not [WaInput]::GetWindowRect($hwnd, [ref]$rect)) { return }
  $w = [Math]::Max(100, $rect.Right - $rect.Left)
  $h = [Math]::Max(100, $rect.Bottom - $rect.Top)
  # Zone de saisie (bas centre) puis bouton envoyer RTL (gauche) et LTR (droite)
  $composeX = [int]($rect.Left + ($w * 0.55))
  $composeY = [int]($rect.Bottom - 48)
  [WaInput]::Click($composeX, $composeY)
  Start-Sleep -Milliseconds 250
  $points = @(
    @{ X = [int]($rect.Left + 36); Y = [int]($rect.Bottom - 42) },
    @{ X = [int]($rect.Right - 36); Y = [int]($rect.Bottom - 42) },
    @{ X = [int]($rect.Left + 56); Y = [int]($rect.Bottom - 56) },
    @{ X = [int]($rect.Right - 56); Y = [int]($rect.Bottom - 56) }
  )
  foreach ($p in $points) {
    [WaInput]::Click($p.X, $p.Y)
    Start-Sleep -Milliseconds 180
  }
}

function Force-WhatsAppSend([IntPtr]$hwnd) {
  if (Invoke-SendButton $hwnd) { return }
  Click-SendZones $hwnd
  Start-Sleep -Milliseconds 200
  [WaInput]::CtrlEnter()
  Start-Sleep -Milliseconds 180
  [System.Windows.Forms.SendKeys]::SendWait('^{ENTER}')
  Start-Sleep -Milliseconds 180
  [WaInput]::Enter()
  Start-Sleep -Milliseconds 180
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Start-Sleep -Milliseconds 250
  if (Invoke-SendButton $hwnd) { return }
  Click-SendZones $hwnd
}

try {
  $proc = Get-WhatsAppWindow
  if ($null -eq $proc) { exit 0 }
  $hwnd = $proc.MainWindowHandle
  [WaInput]::ForceForeground($hwnd)
  $wshell = New-Object -ComObject wscript.shell
  [void]$wshell.AppActivate($proc.Id)
  Start-Sleep -Milliseconds 500

  if ($Mode -eq 'paste' -or $Mode -eq 'paste-enter') {
    # Focus zone de saisie puis collage
    $rect = New-Object WaInput+RECT
    if ([WaInput]::GetWindowRect($hwnd, [ref]$rect)) {
      $w = [Math]::Max(100, $rect.Right - $rect.Left)
      [WaInput]::Click([int]($rect.Left + ($w * 0.55)), [int]($rect.Bottom - 48))
      Start-Sleep -Milliseconds 250
    }
    [WaInput]::SelectAll()
    Start-Sleep -Milliseconds 80
    [WaInput]::Paste()
    Start-Sleep -Milliseconds 200
    [System.Windows.Forms.SendKeys]::SendWait('^v')
    Start-Sleep -Milliseconds 900
  }

  if ($Mode -eq 'enter' -or $Mode -eq 'paste-enter') {
    Force-WhatsAppSend $hwnd
    Start-Sleep -Milliseconds 600
    Force-WhatsAppSend $hwnd
  }
} catch {}
`
      const scriptPath = path.join(
        os.tmpdir(),
        `liste-wa-${process.pid}-${Date.now()}.ps1`,
      )
      try {
        fs.writeFileSync(scriptPath, script, 'utf8')
      } catch {
        resolve()
        return
      }
      execFile(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
        { windowsHide: true },
        () => {
          try {
            fs.unlinkSync(scriptPath)
          } catch {
            /* ignore */
          }
          resolve()
        },
      )
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

type WhatsAppSendError = 'offline' | 'whatsapp_unavailable' | 'failed'
type WhatsAppSendResult = { ok: boolean; error?: WhatsAppSendError }
type WhatsAppStatus = { online: boolean; whatsappAvailable: boolean }

function isNetworkOnline(): boolean {
  try {
    return net.isOnline()
  } catch {
    return true
  }
}

function probeWhatsAppAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      const script = `
$found = $false
# Processus WhatsApp / WhatsApp Beta (noms variables selon install Store ou desktop)
if (Get-Process | Where-Object { $_.ProcessName -match 'WhatsApp' } -ErrorAction SilentlyContinue) {
  $found = $true
}
# Paquets Microsoft Store (WhatsApp Desktop + WhatsApp Beta)
try {
  if (Get-AppxPackage -Name '*WhatsApp*' -ErrorAction SilentlyContinue) { $found = $true }
} catch {}
# Chemins classiques + Beta
$paths = @(
  "$env:LOCALAPPDATA\\WhatsApp\\WhatsApp.exe",
  "$env:LOCALAPPDATA\\Programs\\WhatsApp\\WhatsApp.exe",
  "$env:LOCALAPPDATA\\WhatsAppBeta\\WhatsApp.exe",
  "$env:LOCALAPPDATA\\WhatsAppBeta\\WhatsApp Beta.exe",
  "$env:LOCALAPPDATA\\Programs\\WhatsAppBeta\\WhatsApp.exe",
  "$env:LOCALAPPDATA\\Programs\\WhatsApp Beta\\WhatsApp.exe"
)
foreach ($p in $paths) { if (Test-Path -LiteralPath $p) { $found = $true } }
# Dossiers locaux contenant WhatsApp / Beta
foreach ($root in @("$env:LOCALAPPDATA", "$env:LOCALAPPDATA\\Programs")) {
  try {
    Get-ChildItem -Path $root -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match 'WhatsApp' } |
      ForEach-Object {
        $exe = Get-ChildItem -Path $_.FullName -Filter '*.exe' -Recurse -Depth 3 -ErrorAction SilentlyContinue |
          Where-Object { $_.Name -match 'WhatsApp' } |
          Select-Object -First 1
        if ($null -ne $exe) { $found = $true }
      }
  } catch {}
}
# Protocoles whatsapp / whatsapp-beta
foreach ($root in @('HKCU','HKLM')) {
  foreach ($proto in @('whatsapp','whatsapp-beta')) {
    try {
      $k = Get-ItemProperty -Path ($root + ':\\Software\\Classes\\' + $proto + '\\shell\\open\\command') -ErrorAction SilentlyContinue
      if ($null -ne $k) { $found = $true }
    } catch {}
  }
}
if ($found) { Write-Output '1' } else { Write-Output '0' }
`
      execFile(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { windowsHide: true },
        (err, stdout) => {
          resolve(!err && String(stdout).trim() === '1')
        },
      )
      return
    }

    if (process.platform === 'darwin') {
      execFile(
        'osascript',
        [
          '-e',
          'try\n id of application "WhatsApp"\non error\n id of application "WhatsApp Beta"\nend try',
        ],
        (err) => {
          resolve(!err)
        },
      )
      return
    }

    resolve(true)
  })
}

async function getWhatsAppStatus(): Promise<WhatsAppStatus> {
  const online = isNetworkOnline()
  const whatsappAvailable = await probeWhatsAppAvailable()
  return { online, whatsappAvailable }
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

  // Presse-papiers = source fiable (évite les limites d'URL WhatsApp)
  clipboard.writeText(text)

  // Ne pas bloquer sur le probe (WhatsApp Beta / Store peut échapper à la détection)
  try {
    await shell.openExternal(`whatsapp://send?phone=${phoneNorm}`)
  } catch {
    try {
      await shell.openExternal(`https://wa.me/${phoneNorm}`)
    } catch {
      return { ok: false, error: 'whatsapp_unavailable' }
    }
  }

  // Attendre l'ouverture du chat, coller, puis forcer l'envoi (bouton + Ctrl+Entrée)
  await wait(4200)
  await runWhatsAppKeys('paste-enter')
  await wait(1400)
  await runWhatsAppKeys('enter')
  await wait(1000)
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
