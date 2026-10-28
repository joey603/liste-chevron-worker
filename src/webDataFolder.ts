/** Stockage navigateur : un dossier choisi pour toute l’app (JSON + exports). */

const IDB_NAME = 'liste-chevron-fs'
const IDB_STORE = 'handles'
const IDB_KEY = 'dataFolder'
const IDB_SHIFT_KEY = 'shiftFolder'
const IDB_CAMERA_KEY = 'cameraFolder'

export const DATA_FILE_NAME = 'liste-data.json'
export const SHIFT_LOCAL_FILE_NAME = 'shift-report-local.json'
export const EMAIL_SENT_LOG_FILE_NAME = 'email-sent-log.json'

/** Jetons internes : pointent vers le dossier choisi / ses sous-dossiers. */
export const WEB_FOLDER_ROOT = '__web_data__'
export const WEB_FOLDER_SHIFTS = '__web_data__/דוח משמרת'
export const WEB_FOLDER_CAMERAS = '__web_data__/דוח מצלמות'
/** Noms réels à côté des JSON (singulier d’abord, comme sur le bureau). */
export const SHIFT_FOLDER_CANDIDATES = ['דוח משמרת', 'דוחות משמרת'] as const
export const CAMERA_FOLDER_CANDIDATES = [
  'דוח מצלמות',
  'דוחות מצלמות',
  'יומן מבצעים',
  'יומן מצלמות',
] as const
export const WEB_SHIFTS_SUBDIR = SHIFT_FOLDER_CANDIDATES[0]
export const WEB_CAMERAS_SUBDIR = CAMERA_FOLDER_CANDIDATES[0]

let boundShiftFolderName = WEB_SHIFTS_SUBDIR
let boundCameraFolderName = WEB_CAMERAS_SUBDIR

type DirHandle = FileSystemDirectoryHandle

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('idb_open_failed'))
  })
}

async function idbGet(key: string): Promise<DirHandle | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).get(key)
    req.onsuccess = () => resolve((req.result as DirHandle | undefined) ?? null)
    req.onerror = () => reject(req.error ?? new Error('idb_get_failed'))
  })
}

async function idbSet(key: string, handle: DirHandle): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(handle, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('idb_set_failed'))
  })
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('idb_delete_failed'))
  })
}

async function idbClear(): Promise<void> {
  await idbDelete(IDB_KEY)
  await idbDelete(IDB_SHIFT_KEY)
  await idbDelete(IDB_CAMERA_KEY)
}

/** True uniquement dans l’app installée (preload Electron). */
export function isElectronApp(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.listeApi) &&
    (window as Window & { __listeWebBridge?: boolean }).__listeWebBridge !== true
  )
}

export function isWebFolderSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.showDirectoryPicker === 'function' &&
    !isElectronApp()
  )
}

export function isWebFolderToken(path: string | null | undefined): boolean {
  const p = path?.trim() ?? ''
  if (!p) return false
  if (p.startsWith(WEB_FOLDER_ROOT)) return true
  return (
    (SHIFT_FOLDER_CANDIDATES as readonly string[]).includes(p) ||
    (CAMERA_FOLDER_CANDIDATES as readonly string[]).includes(p)
  )
}

export function looksLikeOsPath(path: string | null | undefined): boolean {
  const p = path?.trim() ?? ''
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\') || p.startsWith('/')
}

async function ensurePermission(
  handle: DirHandle,
  mode: 'read' | 'readwrite',
): Promise<boolean> {
  const opts = { mode } as FileSystemHandlePermissionDescriptor
  const current = await handle.queryPermission(opts)
  if (current === 'granted') return true
  const next = await handle.requestPermission(opts)
  return next === 'granted'
}

async function getStoredHandle(key: string): Promise<DirHandle | null> {
  if (!isWebFolderSupported()) return null
  try {
    const handle = await idbGet(key)
    if (!handle) return null
    if (!(await ensurePermission(handle, 'readwrite'))) return null
    return handle
  } catch {
    return null
  }
}

export async function getStoredDataFolder(): Promise<DirHandle | null> {
  return getStoredHandle(IDB_KEY)
}

export async function getStoredDataFolderName(): Promise<string | null> {
  try {
    const handle = await idbGet(IDB_KEY)
    return handle?.name ?? null
  } catch {
    return null
  }
}

export async function pickDataFolder(): Promise<
  | { ok: true; name: string; handle: DirHandle }
  | { ok: false; canceled?: boolean; error?: string }
> {
  if (!isWebFolderSupported()) {
    return { ok: false, error: 'unsupported' }
  }
  const pick = window.showDirectoryPicker
  if (!pick) return { ok: false, error: 'unsupported' }
  try {
    const handle = await pick({
      id: 'liste-chevron-data',
      mode: 'readwrite',
      startIn: 'documents',
    })
    if (!(await ensurePermission(handle, 'readwrite'))) {
      return { ok: false, error: 'permission_denied' }
    }
    await idbSet(IDB_KEY, handle)
    await ensureAppSubfolders(handle)
    return { ok: true, name: handle.name, handle }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, canceled: true }
    }
    return { ok: false, error: 'pick_failed' }
  }
}

export async function clearStoredDataFolder(): Promise<void> {
  await idbClear()
}

export type ExportFolderKind = 'shift' | 'camera'

function exportFolderIdbKey(kind: ExportFolderKind): string {
  return kind === 'camera' ? IDB_CAMERA_KEY : IDB_SHIFT_KEY
}

export async function pickExportFolder(
  kind: ExportFolderKind,
): Promise<
  | { ok: true; name: string; path: string }
  | { ok: false; canceled?: boolean; error?: string }
> {
  if (!isWebFolderSupported()) return { ok: false, error: 'unsupported' }
  const pick = window.showDirectoryPicker
  if (!pick) return { ok: false, error: 'unsupported' }
  try {
    const handle = await pick({
      id: kind === 'camera' ? 'liste-chevron-cameras' : 'liste-chevron-shifts',
      mode: 'readwrite',
      startIn: 'desktop',
    })
    if (!(await ensurePermission(handle, 'readwrite'))) {
      return { ok: false, error: 'permission_denied' }
    }
    await idbSet(exportFolderIdbKey(kind), handle)
    return { ok: true, name: handle.name, path: handle.name }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, canceled: true }
    }
    return { ok: false, error: 'pick_failed' }
  }
}

/** Import manuel de liste-data.json (quand AppData est bloqué par le navigateur). */
export async function pickListeDataJsonFile(): Promise<
  | { ok: true; mainRaw: unknown; localRaw: unknown | null }
  | { ok: false; canceled?: boolean; error?: string }
> {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,application/json'
  input.style.display = 'none'
  document.body.appendChild(input)
  try {
    const file = await new Promise<File | null>((resolve) => {
      input.onchange = () => resolve(input.files?.[0] ?? null)
      input.oncancel = () => resolve(null)
      input.click()
    })
    if (!file) return { ok: false, canceled: true }
    const text = await file.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return { ok: false, error: 'invalid_json' }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'invalid_json' }
    }
    const obj = parsed as Record<string, unknown>
    const looksLikeShiftLocal =
      'shiftReport' in obj ||
      'shiftReportTexts' in obj ||
      'shiftReportsArchive' in obj ||
      'cameraReport' in obj ||
      'cameraReportsArchive' in obj
    const looksLikeMainList =
      'workers' in obj ||
      'people' in obj ||
      'cardlessPeople' in obj ||
      'banned' in obj ||
      'authorizedPeople' in obj ||
      'guards' in obj
    // shift-report-local.json (même s’il a un bloc settings)
    if (looksLikeShiftLocal && !looksLikeMainList) {
      return { ok: true, mainRaw: {}, localRaw: obj }
    }
    if (looksLikeMainList) {
      return { ok: true, mainRaw: obj, localRaw: null }
    }
    if (looksLikeShiftLocal) {
      return { ok: true, mainRaw: {}, localRaw: obj }
    }
    return { ok: true, mainRaw: obj, localRaw: null }
  } catch {
    return { ok: false, error: 'pick_failed' }
  } finally {
    input.remove()
  }
}

async function findChildDir(
  parent: DirHandle,
  names: readonly string[],
): Promise<{ handle: DirHandle; name: string } | null> {
  const wanted = new Set(names)
  try {
    for await (const entry of parent.values()) {
      if (entry.kind === 'directory' && wanted.has(entry.name)) {
        return { handle: entry as DirHandle, name: entry.name }
      }
    }
  } catch {
    /* values() indisponible */
  }
  for (const name of names) {
    try {
      const handle = await parent.getDirectoryHandle(name, { create: false })
      return { handle, name }
    } catch {
      /* absent */
    }
  }
  return null
}

async function findOrCreateChildDir(
  parent: DirHandle,
  names: readonly string[],
): Promise<{ handle: DirHandle; name: string }> {
  const found = await findChildDir(parent, names)
  if (found) return found
  const name = names[0]
  const handle = await parent.getDirectoryHandle(name, { create: true })
  return { handle, name }
}

/** Relie דוח משמרת / דוח מצלמות (à côté des JSON) et les mémorise. */
export async function bindReportFoldersFromDataDir(
  root: DirHandle,
): Promise<{ shiftName: string; cameraName: string }> {
  const shift = await findOrCreateChildDir(root, SHIFT_FOLDER_CANDIDATES)
  const camera = await findOrCreateChildDir(root, CAMERA_FOLDER_CANDIDATES)
  await idbSet(IDB_SHIFT_KEY, shift.handle)
  await idbSet(IDB_CAMERA_KEY, camera.handle)
  boundShiftFolderName = shift.name
  boundCameraFolderName = camera.name
  return { shiftName: shift.name, cameraName: camera.name }
}

export async function ensureAppSubfolders(root: DirHandle): Promise<void> {
  await bindReportFoldersFromDataDir(root)
}

async function getChildDir(
  parent: DirHandle,
  name: string,
  create: boolean,
): Promise<DirHandle> {
  return parent.getDirectoryHandle(name, { create })
}

function inferExportKind(folderToken: string): ExportFolderKind | null {
  const token = folderToken.trim()
  if (
    token === WEB_FOLDER_CAMERAS ||
    token.startsWith(`${WEB_FOLDER_CAMERAS}/`) ||
    /יומן|מצלמות|camera/i.test(token)
  ) {
    return 'camera'
  }
  if (
    token === WEB_FOLDER_SHIFTS ||
    token.startsWith(`${WEB_FOLDER_SHIFTS}/`) ||
    /משמרת|shift/i.test(token)
  ) {
    return 'shift'
  }
  if (looksLikeOsPath(token)) return 'shift'
  return null
}

export async function resolveWebDir(
  folderToken: string,
  relativeDir = '',
  create = true,
  kind?: ExportFolderKind,
): Promise<DirHandle | null> {
  const token = folderToken.trim()
  const inferred = kind ?? inferExportKind(token)

  let dir: DirHandle | null = null
  if (inferred === 'shift') {
    dir = await getStoredHandle(IDB_SHIFT_KEY)
  } else if (inferred === 'camera') {
    dir = await getStoredHandle(IDB_CAMERA_KEY)
  }

  if (!dir) {
    const root = await getStoredDataFolder()
    if (!root) return null
    const bound = await bindReportFoldersFromDataDir(root)
    try {
      if (inferred === 'shift') {
        dir = await root.getDirectoryHandle(bound.shiftName, { create: false })
      } else if (inferred === 'camera') {
        dir = await root.getDirectoryHandle(bound.cameraName, { create: false })
      }
    } catch {
      dir = null
    }
    if (!dir) dir = root
  }

  const parts = relativeDir
    .split(/[/\\]+/)
    .map((p) => p.trim())
    .filter(Boolean)
  for (const part of parts) {
    dir = await getChildDir(dir, part, create)
  }
  return dir
}

async function readTextFile(
  dir: DirHandle,
  name: string,
): Promise<string | null> {
  try {
    const fileHandle = await dir.getFileHandle(name)
    const file = await fileHandle.getFile()
    return await file.text()
  } catch {
    return null
  }
}

async function writeTextFile(
  dir: DirHandle,
  name: string,
  contents: string,
): Promise<void> {
  const fileHandle = await dir.getFileHandle(name, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(contents)
  await writable.close()
}

export async function readBytesFile(
  dir: DirHandle,
  name: string,
): Promise<Uint8Array | null> {
  try {
    const fileHandle = await dir.getFileHandle(name)
    const file = await fileHandle.getFile()
    return new Uint8Array(await file.arrayBuffer())
  } catch {
    return null
  }
}

export async function writeBytesFile(
  dir: DirHandle,
  name: string,
  bytes: Uint8Array | ArrayBuffer,
): Promise<void> {
  const fileHandle = await dir.getFileHandle(name, { create: true })
  const writable = await fileHandle.createWritable()
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const ab = new ArrayBuffer(src.byteLength)
  new Uint8Array(ab).set(src)
  await writable.write(ab)
  await writable.close()
}

export async function deleteFileIfExists(
  dir: DirHandle,
  name: string,
): Promise<void> {
  try {
    await dir.removeEntry(name)
  } catch {
    /* absent */
  }
}

export async function readAppFilesFromFolder(dir: DirHandle): Promise<{
  mainRaw: unknown | null
  localRaw: unknown | null
}> {
  const mainText = await readTextFile(dir, DATA_FILE_NAME)
  const localText = await readTextFile(dir, SHIFT_LOCAL_FILE_NAME)
  let mainRaw: unknown | null = null
  let localRaw: unknown | null = null
  if (mainText) {
    try {
      mainRaw = JSON.parse(mainText)
    } catch {
      mainRaw = null
    }
  }
  if (localText) {
    try {
      localRaw = JSON.parse(localText)
    } catch {
      localRaw = null
    }
  }
  return { mainRaw, localRaw }
}

export async function writeAppFilesToFolder(
  dir: DirHandle,
  mainJson: string,
  localJson: string,
): Promise<void> {
  await ensureAppSubfolders(dir)
  await writeTextFile(dir, DATA_FILE_NAME, mainJson)
  await writeTextFile(dir, SHIFT_LOCAL_FILE_NAME, localJson)
}

export function withWebSaveFolders<T extends {
  settings?: {
    shiftReportSaveFolder?: string
    cameraReportSaveFolder?: string
  }
}>(data: T): T {
  const settings = data.settings
  if (!settings) return data
  return {
    ...data,
    settings: {
      ...settings,
      shiftReportSaveFolder: boundShiftFolderName,
      cameraReportSaveFolder: boundCameraFolderName,
    },
  }
}
