/** Stockage navigateur : un dossier choisi pour toute l’app (JSON + exports). */

const IDB_NAME = 'liste-chevron-fs'
const IDB_STORE = 'handles'
const IDB_KEY = 'dataFolder'

export const DATA_FILE_NAME = 'liste-data.json'
export const SHIFT_LOCAL_FILE_NAME = 'shift-report-local.json'
export const EMAIL_SENT_LOG_FILE_NAME = 'email-sent-log.json'

/** Jetons internes : pointent vers le dossier choisi / ses sous-dossiers. */
export const WEB_FOLDER_ROOT = '__web_data__'
export const WEB_FOLDER_SHIFTS = '__web_data__/דוחות משמרת'
export const WEB_FOLDER_CAMERAS = '__web_data__/דוחות מצלמות'
export const WEB_SHIFTS_SUBDIR = 'דוחות משמרת'
export const WEB_CAMERAS_SUBDIR = 'דוחות מצלמות'

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

async function idbGet(): Promise<DirHandle | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY)
    req.onsuccess = () => resolve((req.result as DirHandle | undefined) ?? null)
    req.onerror = () => reject(req.error ?? new Error('idb_get_failed'))
  })
}

async function idbSet(handle: DirHandle): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(handle, IDB_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('idb_set_failed'))
  })
}

async function idbClear(): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).delete(IDB_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('idb_clear_failed'))
  })
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
  return Boolean(path?.trim().startsWith(WEB_FOLDER_ROOT))
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

export async function getStoredDataFolder(): Promise<DirHandle | null> {
  if (!isWebFolderSupported()) return null
  try {
    const handle = await idbGet()
    if (!handle) return null
    if (!(await ensurePermission(handle, 'readwrite'))) return null
    return handle
  } catch {
    return null
  }
}

export async function getStoredDataFolderName(): Promise<string | null> {
  try {
    const handle = await idbGet()
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
    await idbSet(handle)
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

export async function ensureAppSubfolders(root: DirHandle): Promise<void> {
  await root.getDirectoryHandle(WEB_SHIFTS_SUBDIR, { create: true })
  await root.getDirectoryHandle(WEB_CAMERAS_SUBDIR, { create: true })
}

async function getChildDir(
  parent: DirHandle,
  name: string,
  create: boolean,
): Promise<DirHandle> {
  return parent.getDirectoryHandle(name, { create })
}

/** Résout un jeton __web_data__/… (+ sous-chemin relatif) vers un handle. */
export async function resolveWebDir(
  folderToken: string,
  relativeDir = '',
  create = true,
): Promise<DirHandle | null> {
  const root = await getStoredDataFolder()
  if (!root) return null
  let dir = root
  const token = folderToken.trim()
  if (token === WEB_FOLDER_SHIFTS || token.startsWith(`${WEB_FOLDER_SHIFTS}/`)) {
    dir = await getChildDir(root, WEB_SHIFTS_SUBDIR, create)
  } else if (
    token === WEB_FOLDER_CAMERAS ||
    token.startsWith(`${WEB_FOLDER_CAMERAS}/`)
  ) {
    dir = await getChildDir(root, WEB_CAMERAS_SUBDIR, create)
  } else if (token !== WEB_FOLDER_ROOT && !isWebFolderToken(token)) {
    // Ancien chemin Windows : tout écrire à la racine du dossier choisi
    dir = root
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
  const shift = settings.shiftReportSaveFolder?.trim() ?? ''
  const camera = settings.cameraReportSaveFolder?.trim() ?? ''
  return {
    ...data,
    settings: {
      ...settings,
      shiftReportSaveFolder:
        !shift || looksLikeOsPath(shift) ? WEB_FOLDER_SHIFTS : shift,
      cameraReportSaveFolder:
        !camera || looksLikeOsPath(camera) ? WEB_FOLDER_CAMERAS : camera,
    },
  }
}
