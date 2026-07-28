import { contextBridge, ipcRenderer } from 'electron'

export type AppData = {
  settings: {
    directorPhone: string
    siteName: string
    visitorSlots: Record<
      string,
      { access: 'closed' | 'open_temp' | 'open_constant'; openUntil: string | null }
    >
  }
  workers: Array<{
    id: string
    firstName: string
    lastName: string
    temporary: boolean
    expiresAt: string | null
  }>
  people: Array<{
    id: string
    kind: 'named' | 'visitor'
    workerId: string | null
    firstName: string
    lastName: string
    visitorNumber: number | null
    enteredAt: string
    exitedAt: string | null
  }>
  banned: Array<{
    id: string
    firstName: string
    lastName: string
    reason: string
    plateNumber: string
    idNumber: string
    addedAt: string
  }>
}

export type UpdateAvailableInfo = {
  version: string
  currentVersion: string
}

export type UpdateProgressInfo = {
  percent: number
  transferred: number
  total: number
}

const api = {
  getData: (): Promise<AppData> => ipcRenderer.invoke('data:get'),
  saveData: (data: AppData): Promise<boolean> => ipcRenderer.invoke('data:save', data),
  copyImage: (dataUrl: string): Promise<boolean> =>
    ipcRenderer.invoke('clipboard:writeImage', dataUrl),
  openWhatsApp: (payload?: {
    text?: string
    phone?: string
  }): Promise<boolean> => ipcRenderer.invoke('whatsapp:open', payload),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
  checkForUpdates: (): Promise<{
    status: 'available' | 'up-to-date' | 'error'
    version?: string
    currentVersion?: string
    message?: string
  }> => ipcRenderer.invoke('update:check'),
  getPendingUpdate: (): Promise<{
    version: string
    currentVersion: string
  } | null> => ipcRenderer.invoke('update:getPending'),
  downloadUpdate: (): Promise<boolean> => ipcRenderer.invoke('update:download'),
  installUpdate: (): Promise<boolean> => ipcRenderer.invoke('update:install'),
  onUpdateAvailable: (cb: (info: UpdateAvailableInfo) => void) => {
    const listener = (_: Electron.IpcRendererEvent, info: UpdateAvailableInfo) =>
      cb(info)
    ipcRenderer.on('update:available', listener)
    return () => ipcRenderer.removeListener('update:available', listener)
  },
  onUpdateProgress: (cb: (info: UpdateProgressInfo) => void) => {
    const listener = (_: Electron.IpcRendererEvent, info: UpdateProgressInfo) =>
      cb(info)
    ipcRenderer.on('update:progress', listener)
    return () => ipcRenderer.removeListener('update:progress', listener)
  },
  onUpdateDownloaded: (cb: (info: { version: string }) => void) => {
    const listener = (
      _: Electron.IpcRendererEvent,
      info: { version: string },
    ) => cb(info)
    ipcRenderer.on('update:downloaded', listener)
    return () => ipcRenderer.removeListener('update:downloaded', listener)
  },
  onUpdateError: (cb: (info: { message: string }) => void) => {
    const listener = (
      _: Electron.IpcRendererEvent,
      info: { message: string },
    ) => cb(info)
    ipcRenderer.on('update:error', listener)
    return () => ipcRenderer.removeListener('update:error', listener)
  },
}

contextBridge.exposeInMainWorld('listeApi', api)
