/** Stockage navigateur : dossier choisi + liste-data.json (comme l’ancienne app). */

const IDB_NAME = 'liste-chevron-fs'
const IDB_STORE = 'handles'
const IDB_KEY = 'dataFolder'
export const DATA_FILE_NAME = 'liste-data.json'
export const SHIFT_LOCAL_FILE_NAME = 'shift-report-local.json'

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

export function isWebFolderSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.showDirectoryPicker === 'function' &&
    !window.listeApi
  )
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
  await writeTextFile(dir, DATA_FILE_NAME, mainJson)
  await writeTextFile(dir, SHIFT_LOCAL_FILE_NAME, localJson)
}
