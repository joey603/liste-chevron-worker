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
    absenceWatchPhone?: string
    absenceWatchWorkerId?: string
    absenceWatchEnabled?: boolean
    telegramBotToken?: string
    telegramChatId?: string
    telegramEmergencyChatId?: string
    telegramDailyListEnabled?: boolean
    telegramDailyListTime?: string
    seenExcelNotes?: Record<string, string>
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
    newFromExcel?: boolean
  }>
  cardlessPeople: Array<{
    id: string
    firstName: string
    lastName: string
    temporary: boolean
    expiresAt: string | null
    assignment: 'unique' | 'multiple'
    newFromExcel?: boolean
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
  pickGuardRosterExcel: (): Promise<{
    ok: boolean
    canceled?: boolean
    path?: string
  }> => ipcRenderer.invoke('guardRoster:pickExcel'),
  readGuardRosterExcel: (
    filePath: string,
  ): Promise<
    | { ok: true; guards: unknown[] }
    | { ok: false; error?: string }
  > => ipcRenderer.invoke('guardRoster:readExcel', filePath),
  writeGuardRosterExcel: (payload: {
    filePath: string
    guards: unknown[]
  }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('guardRoster:writeExcel', payload),
  pickAuthorizedListExcel: (): Promise<{
    ok: boolean
    canceled?: boolean
    path?: string
  }> => ipcRenderer.invoke('authorizedList:pickExcel'),
  createAuthorizedListExcel: (payload?: {
    defaultName?: string
  }): Promise<{
    ok: boolean
    canceled?: boolean
    path?: string
    error?: string
  }> => ipcRenderer.invoke('authorizedList:createExcel', payload),
  readAuthorizedListExcel: (
    filePath: string,
  ): Promise<
    | { ok: true; people: unknown[] }
    | { ok: false; error?: string }
  > => ipcRenderer.invoke('authorizedList:readExcel', filePath),
  writeAuthorizedListExcel: (payload: {
    filePath: string
    people: unknown[]
  }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('authorizedList:writeExcel', payload),
  getAuthorizedListExcelMtime: (
    filePath: string,
  ): Promise<number | null> =>
    ipcRenderer.invoke('authorizedList:mtime', filePath),
  saveShiftReportFiles: (payload: {
    folder: string
    relativeDir: string
    docxFileName: string
    jsonFileName: string
    json: string
    docxBytes: number[]
  }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('shiftReport:saveFiles', payload),
  deleteShiftReportFiles: (payload: {
    folder: string
    relativeDir: string
    docxFileName: string
    jsonFileName: string
  }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('shiftReport:deleteFiles', payload),
  saveCameraReportWorkbook: (payload: {
    folder: string
    relativeDir: string
    fileName: string
    year: number
    month: number
    archive: Record<string, unknown>
    currentReport: Record<string, unknown>
  }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('cameraReport:saveWorkbook', payload),
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
  }): Promise<{ ok: boolean; messageId?: string; error?: string }> =>
    ipcRenderer.invoke('shiftReport:sendEmail', payload),
  getShiftReportEmailStatus: (payload: { date: string }) =>
    ipcRenderer.invoke('shiftReport:emailStatus', payload),
  getShiftReportEmailSentLog: () =>
    ipcRenderer.invoke('shiftReport:emailSentLog'),
  sendShiftReportEmail: (payload: { date: string; force?: boolean }) =>
    ipcRenderer.invoke('shiftReport:sendReportEmail', payload),
  getCameraMonthlyEmailStatus: (payload: { year: number; month: number }) =>
    ipcRenderer.invoke('cameraReport:monthlyEmailStatus', payload),
  sendCameraMonthlyEmail: (payload: {
    year: number
    month: number
    force?: boolean
  }) => ipcRenderer.invoke('cameraReport:sendMonthlyEmail', payload),
  copyImage: (dataUrl: string): Promise<boolean> =>
    ipcRenderer.invoke('clipboard:writeImage', dataUrl),
  sendTelegramText: (
    text: string,
    chatId?: string,
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('telegram:sendText', text, chatId),
  sendTelegramPhoto: (
    imageDataUrl: string,
    caption?: string,
    chatId?: string,
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('telegram:sendPhoto', imageDataUrl, caption, chatId),
  testTelegram: (): Promise<{
    ok: boolean
    error?: string
    chatId?: string
  }> => ipcRenderer.invoke('telegram:test'),
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
