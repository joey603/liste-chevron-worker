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

const api = {
  getData: (): Promise<AppData> => ipcRenderer.invoke('data:get'),
  saveData: (data: AppData): Promise<boolean> => ipcRenderer.invoke('data:save', data),
  copyImage: (dataUrl: string): Promise<boolean> =>
    ipcRenderer.invoke('clipboard:writeImage', dataUrl),
  openWhatsApp: (): Promise<boolean> => ipcRenderer.invoke('whatsapp:open'),
}

contextBridge.exposeInMainWorld('listeApi', api)
