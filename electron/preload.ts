import { contextBridge, ipcRenderer } from 'electron'

export type AppData = {
  settings: {
    directorPhone: string
    emergencyPhones: Array<{
      id: string
      name: string
      phone: string
      emergency: boolean
    }>
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
  cardlessPeople: Array<{
    id: string
    firstName: string
    lastName: string
    temporary: boolean
    expiresAt: string | null
    assignment: 'unique' | 'multiple'
  }>
  people: Array<{
    id: string
    kind: 'named' | 'visitor'
    workerId: string | null
    cardlessPersonId: string | null
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
  getShiftReportLocalPath: (): Promise<{ ok: boolean; path?: string }> =>
    ipcRenderer.invoke('shiftReport:localPath'),
  saveBytes: (payload: {
    defaultName: string
    bytes: number[]
    filters?: { name: string; extensions: string[] }[]
  }): Promise<{ ok: boolean; canceled?: boolean; path?: string }> =>
    ipcRenderer.invoke('file:saveBytes', payload),
  pickFolder: (): Promise<{ ok: boolean; canceled?: boolean; path?: string }> =>
    ipcRenderer.invoke('folder:pick'),
  saveShiftReportFiles: (payload: {
    folder: string
    relativeDir: string
    docxFileName: string
    jsonFileName: string
    json: string
    docxBytes: number[]
  }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('shiftReport:saveFiles', payload),
  sendShiftReportTestEmail: (payload: {
    directorEmail: string
    smtpHost: string
    smtpPort: number
    smtpUser: string
    smtpPass: string
  }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('shiftReport:testEmail', payload),
  sendShiftReportsEmail: (payload: {
    date: string
    directorEmail: string
    smtpHost: string
    smtpPort: number
    smtpUser: string
    smtpPass: string
    attachments: Array<{ name: string; bytes: number[] }>
  }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('shiftReport:sendEmail', payload),
  copyImage: (dataUrl: string): Promise<boolean> =>
    ipcRenderer.invoke('clipboard:writeImage', dataUrl),
  openWhatsApp: (): Promise<boolean> => ipcRenderer.invoke('whatsapp:open'),
  shareImageToWhatsApp: (
    dataUrl: string,
  ): Promise<{
    ok: boolean
    error?: 'whatsapp_not_connected' | 'no_chat' | 'pending_chat' | 'failed'
  }> => ipcRenderer.invoke('whatsapp:shareImage', dataUrl),
  getWhatsAppStatus: (): Promise<{
    online: boolean
    whatsappAvailable: boolean
    channel: 'desktop' | 'web' | 'none'
    connected: boolean
    desktopInstalled: boolean
    desktopRunning: boolean
    webOpen: boolean
    detail: string
  }> => ipcRenderer.invoke('whatsapp:status'),
  openWhatsAppWebSession: (): Promise<{
    online: boolean
    whatsappAvailable: boolean
    channel: 'desktop' | 'web' | 'none'
    connected: boolean
    desktopInstalled: boolean
    desktopRunning: boolean
    webOpen: boolean
    detail: string
  }> => ipcRenderer.invoke('whatsapp:openWebSession'),
  sendWhatsAppText: (
    phone: string | string[],
    text: string,
    imageDataUrl?: string,
  ): Promise<{
    ok: boolean
    error?:
      | 'offline'
      | 'whatsapp_unavailable'
      | 'whatsapp_not_connected'
      | 'failed'
  }> => ipcRenderer.invoke('whatsapp:sendText', phone, text, imageDataUrl),
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
