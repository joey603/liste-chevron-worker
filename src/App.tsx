import { CSSProperties, FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { domToPng } from 'modern-screenshot'
import ShiftReportPanel from './ShiftReportPanel'
import type { ShiftKind, ShiftReport, ShiftReportTexts } from './shiftReport'
import {
  getOperationalDayDate,
  getNextShift,
  getShiftFromArchive,
  upsertShiftInArchive,
} from './shiftReportArchive'
import { scheduleShiftReportAutoSave, flushShiftReportAutoSave } from './shiftReportAutoSave'
import { normalizeShiftReportTexts } from './shiftReport'
import {
  extractShiftLocalPayload,
  mergeShiftIntoMain,
  SHIFT_REPORT_LOCAL_STORAGE_KEY,
  stripShiftFromMain,
} from './shiftReportLocalStore'
import {
  AppData,
  BannedPerson,
  CardlessAssignment,
  CardlessPerson,
  ContactPhone,
  PersonEntry,
  VISITOR_COUNT,
  VisitorAccess,
  Worker,
  bannedDisplayName,
  buildEmergencyMessage,
  cardlessDisplayName,
  comparePresentByName,
  contactDisplayName,
  createId,
  displayName,
  emergencyDialPhones,
  endOfTodayMidnight,
  formatDateTime,
  formatTime,
  isCardlessBlocked,
  isEnteredAfterSevenAm,
  getVisitorSlot,
  isPresent,
  isVisitorNumberOpen,
  isVisitorPresent,
  isWorkerPresent,
  normalizeData,
  normalizeWhatsAppPhone,
  purgeExpiredWorkers,
  visitorAffiliatedName,
  WhatsAppStatus,
  whatsappStatusLabel,
  workerDisplayName,
} from './types'
import chevronLogo from './assets/chevron-logo.png'

const HEBREW_ALPHABET = [
  'א',
  'ב',
  'ג',
  'ד',
  'ה',
  'ו',
  'ז',
  'ח',
  'ט',
  'י',
  'כ',
  'ל',
  'מ',
  'נ',
  'ס',
  'ע',
  'פ',
  'צ',
  'ק',
  'ר',
  'ש',
  'ת',
] as const

const HEBREW_FINAL_TO_REGULAR: Record<string, string> = {
  ך: 'כ',
  ם: 'מ',
  ן: 'נ',
  ף: 'פ',
  ץ: 'צ',
}

function workerAlphaLetter(worker: Worker): string {
  const raw = workerDisplayName(worker).trim().charAt(0)
  const letter = HEBREW_FINAL_TO_REGULAR[raw] ?? raw
  return (HEBREW_ALPHABET as readonly string[]).includes(letter) ? letter : '#'
}

function cardlessAlphaLetter(person: CardlessPerson): string {
  const raw = cardlessDisplayName(person).trim().charAt(0)
  const letter = HEBREW_FINAL_TO_REGULAR[raw] ?? raw
  return (HEBREW_ALPHABET as readonly string[]).includes(letter) ? letter : '#'
}

function Icon({
  children,
  className = '',
  size = 16,
}: {
  children: ReactNode
  className?: string
  size?: number
}) {
  return (
    <svg
      className={`ui-icon ${className}`.trim()}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

function IconSearch({ size = 16 }: { size?: number }) {
  return (
    <Icon size={size} className="icon-search">
      <circle
        cx="11"
        cy="11"
        r="6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
      />
      <path
        d="M16.2 16.2 L20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </Icon>
  )
}

function IconEdit({ size = 16 }: { size?: number }) {
  return (
    <Icon size={size} className="icon-edit">
      <path
        d="M4 20 L8.2 18.9 L19.2 7.9 C19.9 7.2 19.9 6.1 19.2 5.4 L18.1 4.3 C17.4 3.6 16.3 3.6 15.6 4.3 L4.6 15.3 L3.5 19.5 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M14.8 5.2 L18.3 8.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </Icon>
  )
}

function IconTrash({ size = 16 }: { size?: number }) {
  return (
    <Icon size={size} className="icon-trash">
      <path
        d="M5 7.5 H19"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M9 7.5 V5.8 C9 5.2 9.5 4.8 10.1 4.8 H13.9 C14.5 4.8 15 5.2 15 5.8 V7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M7.2 7.5 L8 19 C8.1 19.6 8.5 20 9.1 20 H14.9 C15.5 20 15.9 19.6 16 19 L16.8 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M10.2 11 V16.5 M13.8 11 V16.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </Icon>
  )
}

function IconAlert({ size = 16 }: { size?: number }) {
  return (
    <Icon size={size} className="icon-alert">
      <path
        d="M12 3.5 L21 19.5 H3 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M12 9.5 V13.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <circle cx="12" cy="16.4" r="1.05" fill="currentColor" />
    </Icon>
  )
}

function IconPhone({ size = 16 }: { size?: number }) {
  return (
    <Icon size={size} className="icon-phone">
      <path
        d="M7.2 3.8 H10 L11.2 7.2 L9.3 8.4 C10.1 10.1 11.4 11.6 13.1 12.8 L14.4 11 L17.8 12.2 V15 C17.8 15.8 17.1 16.5 16.3 16.5 C10.2 16.5 5.3 11.6 5.3 5.5 C5.3 4.7 6 4 6.8 4 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        transform="translate(1 1.2)"
      />
    </Icon>
  )
}

type Toast = { message: string } | null
type AppTab = 'presence' | 'banned' | 'cameras' | 'shift'
type ListSort = 'time_asc' | 'time_desc' | 'name'
type ListLayout = 'rows' | 'columns'
type ListKindFilter = 'all' | 'visitors' | 'workers_constant' | 'workers_temporary'
type ColumnChoice = number | 'max'

const COLUMN_CHOICE_MAX = 10

type FancySelectOption = { value: string; label: string }

function FancySelect({
  value,
  options,
  onChange,
  label,
  ariaLabel,
  className = '',
  triggerClassName = '',
}: {
  value: string
  options: FancySelectOption[]
  onChange: (value: string) => void
  label?: string
  ariaLabel: string
  className?: string
  triggerClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({
    position: 'fixed',
    top: 0,
    left: 0,
    width: 120,
    zIndex: 4000,
  })
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)
  const selected = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return

    const placeMenu = () => {
      const el = triggerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const width = Math.max(rect.width, 88)
      let left = rect.left
      const maxLeft = window.innerWidth - width - 8
      if (left > maxLeft) left = Math.max(8, maxLeft)
      if (left < 8) left = 8
      setMenuStyle({
        position: 'fixed',
        top: Math.round(rect.bottom + 4),
        left: Math.round(left),
        width: Math.round(width),
        zIndex: 4000,
      })
    }

    const frame = window.requestAnimationFrame(placeMenu)
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (rootRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('resize', placeMenu)
    window.addEventListener('scroll', placeMenu, true)
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKey)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', placeMenu)
      window.removeEventListener('scroll', placeMenu, true)
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={`fancy-select ${className}`.trim()} ref={rootRef}>
      {label ? <span className="fancy-select-label">{label}</span> : null}
      <div className="fancy-select-dropdown">
        <button
          ref={triggerRef}
          type="button"
          className={`fancy-select-trigger ${triggerClassName} ${open ? 'open' : ''}`.trim()}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
        >
          <span className="fancy-select-value">{selected?.label ?? value}</span>
          <svg
            className="fancy-select-caret"
            viewBox="0 0 12 12"
            width="12"
            height="12"
            aria-hidden="true"
          >
            <path
              d="M2.5 4.5 L6 8 L9.5 4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {open &&
          createPortal(
            <ul
              ref={menuRef}
              className="fancy-select-menu"
              role="listbox"
              style={menuStyle}
            >
              {options.map((opt) => {
                const isActive = opt.value === value
                return (
                  <li
                    key={opt.value}
                    role="option"
                    aria-selected={isActive}
                  >
                    <button
                      type="button"
                      className={`fancy-select-option ${isActive ? 'active' : ''}`}
                      onClick={() => {
                        onChange(opt.value)
                        setOpen(false)
                      }}
                    >
                      {opt.label}
                    </button>
                  </li>
                )
              })}
            </ul>,
            document.body,
          )}
      </div>
    </div>
  )
}

function ColumnCountPicker({
  choice,
  onChange,
}: {
  choice: ColumnChoice
  onChange: (value: ColumnChoice) => void
}) {
  const options: FancySelectOption[] = [
    ...Array.from({ length: COLUMN_CHOICE_MAX }, (_, i) => ({
      value: String(i + 1),
      label: String(i + 1),
    })),
    { value: 'max', label: 'max' },
  ]

  return (
    <FancySelect
      className="column-count-picker"
      triggerClassName="column-count-trigger"
      label="עמודות"
      ariaLabel="מספר עמודות"
      value={choice === 'max' ? 'max' : String(choice)}
      options={options}
      onChange={(raw) => onChange(raw === 'max' ? 'max' : Number(raw))}
    />
  )
}

const emptyNamed = { firstName: '', lastName: '' }
const emptyBanned = {
  firstName: '',
  lastName: '',
  reason: '',
  plateNumber: '',
  idNumber: '',
}

function browserFallback(): AppData {
  const raw = localStorage.getItem('liste-chevron-data')
  if (raw) {
    try {
      return normalizeData(JSON.parse(raw) as Partial<AppData>)
    } catch {
      /* ignore */
    }
  }
  return normalizeData(null)
}

async function loadData(): Promise<AppData> {
  if (window.listeApi) return normalizeData(await window.listeApi.getData())
  try {
    const mainRaw = JSON.parse(
      localStorage.getItem('liste-chevron-data') ?? 'null',
    )
    const localRaw = JSON.parse(
      localStorage.getItem(SHIFT_REPORT_LOCAL_STORAGE_KEY) ?? 'null',
    )
    const merged = mergeShiftIntoMain(mainRaw ?? {}, localRaw ?? {})
    return normalizeData(merged)
  } catch {
    return browserFallback()
  }
}

async function saveData(data: AppData): Promise<void> {
  if (window.listeApi) {
    await window.listeApi.saveData(data)
    return
  }
  const normalized = normalizeData(data)
  localStorage.setItem(
    SHIFT_REPORT_LOCAL_STORAGE_KEY,
    JSON.stringify(extractShiftLocalPayload(normalized)),
  )
  localStorage.setItem(
    'liste-chevron-data',
    JSON.stringify(stripShiftFromMain(normalized)),
  )
}

export default function App() {
  const [data, setData] = useState<AppData | null>(null)
  const [showNewWorker, setShowNewWorker] = useState(false)
  const [newWorker, setNewWorker] = useState(emptyNamed)
  const [newWorkerTemporary, setNewWorkerTemporary] = useState(false)
  const [showNewCardless, setShowNewCardless] = useState(false)
  const [newCardless, setNewCardless] = useState(emptyNamed)
  const [newCardlessTemporary, setNewCardlessTemporary] = useState(false)
  const [newCardlessAssignment, setNewCardlessAssignment] =
    useState<CardlessAssignment>('unique')
  const [manageMode, setManageMode] = useState<'none' | 'edit' | 'delete'>('none')
  const [editingWorker, setEditingWorker] = useState<Worker | null>(null)
  const [editingCardless, setEditingCardless] = useState<CardlessPerson | null>(
    null,
  )
  const [selectedCardlessId, setSelectedCardlessId] = useState<string | null>(
    null,
  )
  const [activeTab, setActiveTab] = useState<AppTab>('presence')
  const [showBannedModal, setShowBannedModal] = useState(false)
  const [newBanned, setNewBanned] = useState(emptyBanned)
  const [editingBanned, setEditingBanned] = useState<BannedPerson | null>(null)
  const [toast, setToast] = useState<Toast>(null)
  const [busy, setBusy] = useState(false)
  const [showListPreview, setShowListPreview] = useState(false)
  const [showShareTarget, setShowShareTarget] = useState(false)
  const [sharePhoneDraft, setSharePhoneDraft] = useState('')
  const [updateState, setUpdateState] = useState<
    | null
    | { phase: 'available'; version: string }
    | { phase: 'downloading'; version: string; percent: number }
    | { phase: 'installing'; version: string }
    | { phase: 'error'; message: string }
  >(null)
  const [updateChecking, setUpdateChecking] = useState(false)
  const [listSearch, setListSearch] = useState('')
  const [listSort, setListSort] = useState<ListSort>('time_asc')
  const [listLayout, setListLayout] = useState<ListLayout>('rows')
  const [previewLayout, setPreviewLayout] = useState<ListLayout>('columns')
  const [listColumnChoice, setListColumnChoice] = useState<ColumnChoice>('max')
  const [previewColumnChoice, setPreviewColumnChoice] =
    useState<ColumnChoice>('max')
  const [listKindFilter, setListKindFilter] = useState<ListKindFilter>('all')
  const [whatsappStatus, setWhatsappStatus] = useState<WhatsAppStatus>({
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    whatsappAvailable: true,
    channel: 'none',
    connected: true,
    desktopInstalled: false,
    desktopRunning: false,
    webOpen: false,
    detail: 'unknown',
  })
  const whatsappWarn = whatsappStatusLabel(whatsappStatus)

  const [viewportTick, setViewportTick] = useState(0)

  async function refreshWhatsAppStatus() {
    const online = typeof navigator !== 'undefined' ? navigator.onLine : true
    if (window.listeApi?.getWhatsAppStatus) {
      try {
        const status = await window.listeApi.getWhatsAppStatus()
        setWhatsappStatus(status)
        return
      } catch {
        /* fallback below */
      }
    }
    setWhatsappStatus((prev) => ({ ...prev, online }))
  }

  async function openWhatsAppWebLogin() {
    if (!window.listeApi?.openWhatsAppWebSession) {
      setToast({ message: 'פתיחת WhatsApp Web זמינה רק באפליקציה המותקנת' })
      return
    }
    setToast({ message: 'פותח WhatsApp Web להתחברות…' })
    try {
      const status = await window.listeApi.openWhatsAppWebSession()
      setWhatsappStatus(status)
      if (status.connected || status.whatsappAvailable) {
        setToast({ message: 'WhatsApp Web מחובר' })
      } else {
        setToast({
          message: 'סרקו את קוד ה־QR בחלון WhatsApp Web שנפתח',
        })
      }
    } catch {
      setToast({ message: 'לא ניתן לפתוח את חלון WhatsApp Web' })
    }
  }

  useEffect(() => {
    let cancelled = false

    async function refresh() {
      if (cancelled) return
      await refreshWhatsAppStatus()
    }

    void refresh()
    const onOnline = () => void refresh()
    const onOffline = () =>
      setWhatsappStatus((prev) => ({ ...prev, online: false }))
    const onFocus = () => void refresh()
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('focus', onFocus)
    const interval = window.setInterval(() => void refresh(), 8000)
    return () => {
      cancelled = true
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('focus', onFocus)
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    const onResize = () => setViewportTick((n) => n + 1)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  function computeMaxColumns(count: number, forDocument: boolean): number {
    if (count <= 1) return 1
    const rowHeight = forDocument ? 38 : 52
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800
    const available = forDocument
      ? Math.max(280, Math.min(vh * 0.55, 620))
      : Math.max(260, Math.min(vh * 0.48, 680))
    const maxRows = Math.max(1, Math.floor(available / rowHeight))
    const needed = Math.ceil(count / maxRows)
    return Math.min(COLUMN_CHOICE_MAX, Math.max(1, needed))
  }

  function resolveColumnCount(
    choice: ColumnChoice,
    fitMax: number,
  ): number {
    if (choice === 'max') return fitMax
    return Math.min(COLUMN_CHOICE_MAX, Math.max(1, choice))
  }
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarRoster, setSidebarRoster] = useState<'workers' | 'visitors'>(
    'workers',
  )
  const [workerSearch, setWorkerSearch] = useState('')
  const [activeWorkerLetter, setActiveWorkerLetter] = useState<string>('א')
  const [activeCardlessLetter, setActiveCardlessLetter] = useState<string>('א')
  const [showVisitorManage, setShowVisitorManage] = useState(false)
  const [showEmergencyPhones, setShowEmergencyPhones] = useState(false)
  const [emergencyPhoneDraft, setEmergencyPhoneDraft] = useState('')
  const [emergencyNameDraft, setEmergencyNameDraft] = useState('')
  const [emergencyFlagDraft, setEmergencyFlagDraft] = useState(true)
  const [visitorManageMode, setVisitorManageMode] =
    useState<VisitorAccess>('closed')
  const listRef = useRef<HTMLDivElement>(null)
  const shareRef = useRef<HTMLDivElement>(null)
  const workersScrollRef = useRef<HTMLDivElement>(null)
  const workersAlphaLettersRef = useRef<HTMLDivElement>(null)
  const cardlessScrollRef = useRef<HTMLDivElement>(null)
  const cardlessAlphaLettersRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadData().then((loaded) => setData(normalizeData(loaded)))
  }, [])

  useEffect(() => {
    if (!data) return
    const slots = data.settings?.visitorSlots
    if (slots && Object.keys(slots).length >= VISITOR_COUNT) return
    const fixed = normalizeData(data)
    setData(fixed)
    void saveData(fixed)
  }, [data])

  useEffect(() => {
    if (!data) return

    const clean = () => {
      setData((prev) => {
        if (!prev) return prev
        const next = purgeExpiredWorkers(normalizeData(prev))
        if (
          next === prev ||
          JSON.stringify(next) === JSON.stringify(prev)
        ) {
          return prev
        }
        void saveData(next)
        return next
      })
    }

    clean()
    const timer = window.setInterval(clean, 60_000)
    const onFocus = () => clean()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [data === null])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(t)
  }, [toast])

  useEffect(() => {
    const api = window.listeApi
    if (!api?.onUpdateAvailable) return

    const offAvailable = api.onUpdateAvailable((info) => {
      setUpdateState({ phase: 'available', version: info.version })
    })
    const offProgress = api.onUpdateProgress((info) => {
      setUpdateState((prev) => {
        const version =
          prev && 'version' in prev ? prev.version : __APP_VERSION__
        return {
          phase: 'downloading',
          version,
          percent: Math.max(0, Math.min(100, info.percent || 0)),
        }
      })
    })
    const offDownloaded = api.onUpdateDownloaded((info) => {
      setUpdateState({ phase: 'installing', version: info.version })
      void api.installUpdate()
    })
    const offError = api.onUpdateError((info) => {
      setUpdateState({ phase: 'error', message: info.message })
    })

    void (async () => {
      // Au démarrage : seulement récupérer une MAJ déjà trouvée par le main
      // (check réseau fait une fois au lancement côté Electron, ou via le badge version)
      const pending = await api.getPendingUpdate?.()
      if (pending?.version) {
        setUpdateState({ phase: 'available', version: pending.version })
      }
    })()

    return () => {
      offAvailable()
      offProgress()
      offDownloaded()
      offError()
    }
  }, [])

  async function startUpdateDownload() {
    if (!window.listeApi?.downloadUpdate || !updateState) return
    if (updateState.phase !== 'available') return
    setUpdateState({
      phase: 'downloading',
      version: updateState.version,
      percent: 0,
    })
    try {
      await window.listeApi.downloadUpdate()
    } catch {
      setUpdateState({
        phase: 'error',
        message: 'הורדת העדכון נכשלה',
      })
    }
  }

  async function checkUpdatesFromBadge() {
    if (
      updateState?.phase === 'downloading' ||
      updateState?.phase === 'installing' ||
      updateChecking
    ) {
      return
    }
    if (!window.listeApi?.checkForUpdates) {
      setToast({ message: 'בדיקת עדכונים זמינה רק באפליקציה המותקנת' })
      return
    }

    setUpdateChecking(true)
    try {
      const pending = await window.listeApi.getPendingUpdate?.()
      if (pending?.version) {
        setUpdateState({ phase: 'available', version: pending.version })
        return
      }

      const result = await window.listeApi.checkForUpdates()
      if (result.status === 'available' && result.version) {
        setUpdateState({ phase: 'available', version: result.version })
        return
      }
      if (result.status === 'error') {
        setUpdateState({
          phase: 'error',
          message: result.message || 'בדיקת העדכון נכשלה',
        })
        return
      }
      setToast({
        message: `אתם בגרסה העדכנית ביותר (v${result.version || __APP_VERSION__})`,
      })
    } catch {
      setToast({ message: 'בדיקת העדכון נכשלה' })
    } finally {
      setUpdateChecking(false)
    }
  }

  const presentCount = data?.people.filter(isPresent).length ?? 0

  const sortedWorkers = useMemo(() => {
    if (!data) return []
    return [...data.workers].sort((a, b) =>
      workerDisplayName(a).localeCompare(workerDisplayName(b), 'he'),
    )
  }, [data])

  const filteredWorkers = useMemo(() => {
    const query = workerSearch.trim().toLowerCase()
    if (!query) return sortedWorkers
    return sortedWorkers.filter((w) =>
      workerDisplayName(w).toLowerCase().includes(query),
    )
  }, [sortedWorkers, workerSearch])

  const workerLettersPresent = useMemo(() => {
    const set = new Set<string>()
    for (const worker of filteredWorkers) {
      set.add(workerAlphaLetter(worker))
    }
    return set
  }, [filteredWorkers])

  const workerAlphaLetters = useMemo(() => [...HEBREW_ALPHABET], [])

  const sortedCardlessPeople = useMemo(() => {
    if (!data) return []
    return [...data.cardlessPeople].sort((a, b) =>
      cardlessDisplayName(a).localeCompare(cardlessDisplayName(b), 'he'),
    )
  }, [data])

  const cardlessLettersPresent = useMemo(() => {
    const set = new Set<string>()
    for (const person of sortedCardlessPeople) {
      set.add(cardlessAlphaLetter(person))
    }
    return set
  }, [sortedCardlessPeople])

  /** Barre compacte : seulement les lettres présentes dans la liste */
  const cardlessAlphaLetters = useMemo((): string[] => {
    const letters: string[] = HEBREW_ALPHABET.filter((letter) =>
      cardlessLettersPresent.has(letter),
    )
    if (cardlessLettersPresent.has('#')) letters.push('#')
    return letters
  }, [cardlessLettersPresent])

  useEffect(() => {
    if (sortedWorkers.length === 0 && manageMode !== 'none') {
      setManageMode('none')
      setEditingWorker(null)
    }
  }, [sortedWorkers.length, manageMode])

  useEffect(() => {
    if (
      sidebarRoster === 'visitors' &&
      (data?.cardlessPeople.length ?? 0) === 0 &&
      manageMode !== 'none'
    ) {
      setManageMode('none')
      setEditingCardless(null)
    }
  }, [data?.cardlessPeople.length, manageMode, sidebarRoster])

  useEffect(() => {
    if (!selectedCardlessId || !data) return
    if (!data.cardlessPeople.some((c) => c.id === selectedCardlessId)) {
      setSelectedCardlessId(null)
    }
  }, [data, selectedCardlessId])

  useEffect(() => {
    if (cardlessAlphaLetters.length === 0) return
    if (!cardlessAlphaLetters.includes(activeCardlessLetter)) {
      setActiveCardlessLetter(cardlessAlphaLetters[0])
    }
  }, [cardlessAlphaLetters, activeCardlessLetter])

  useEffect(() => {
    const root = workersScrollRef.current
    if (!root || filteredWorkers.length === 0 || sidebarRoster !== 'workers') {
      return
    }

    const updateActiveLetter = () => {
      const wraps = root.querySelectorAll<HTMLElement>('[data-alpha-letter]')
      if (wraps.length === 0) return
      const rootTop = root.getBoundingClientRect().top
      let current = wraps[0].dataset.alphaLetter || 'א'
      for (const wrap of wraps) {
        const top = wrap.getBoundingClientRect().top - rootTop
        if (top <= 12) {
          current = wrap.dataset.alphaLetter || current
        } else {
          break
        }
      }
      setActiveWorkerLetter(current)
    }

    updateActiveLetter()
    root.addEventListener('scroll', updateActiveLetter, { passive: true })
    return () => root.removeEventListener('scroll', updateActiveLetter)
  }, [filteredWorkers, sidebarRoster])

  useEffect(() => {
    const root = cardlessScrollRef.current
    if (
      !root ||
      sortedCardlessPeople.length === 0 ||
      sidebarRoster !== 'visitors'
    ) {
      return
    }

    const updateActiveLetter = () => {
      const wraps = root.querySelectorAll<HTMLElement>('[data-alpha-letter]')
      if (wraps.length === 0) return
      const rootTop = root.getBoundingClientRect().top
      let current = wraps[0].dataset.alphaLetter || 'א'
      for (const wrap of wraps) {
        const top = wrap.getBoundingClientRect().top - rootTop
        if (top <= 12) {
          current = wrap.dataset.alphaLetter || current
        } else {
          break
        }
      }
      setActiveCardlessLetter(current)
    }

    updateActiveLetter()
    root.addEventListener('scroll', updateActiveLetter, { passive: true })
    return () => root.removeEventListener('scroll', updateActiveLetter)
  }, [sortedCardlessPeople, sidebarRoster])

  useEffect(() => {
    const rail = workersAlphaLettersRef.current
    if (!rail || sidebarRoster !== 'workers') return
    const activeBtn = rail.querySelector<HTMLElement>(
      '.workers-alpha-letter.is-active',
    )
    if (!activeBtn) return
    activeBtn.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeWorkerLetter, sidebarRoster, workerAlphaLetters])

  useEffect(() => {
    const rail = cardlessAlphaLettersRef.current
    if (!rail || sidebarRoster !== 'visitors') return
    const activeBtn = rail.querySelector<HTMLElement>(
      '.workers-alpha-letter.is-active',
    )
    if (!activeBtn) return
    activeBtn.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeCardlessLetter, sidebarRoster, cardlessAlphaLetters])

  function scrollWorkersToLetter(letter: string) {
    const root = workersScrollRef.current
    if (!root) return
    const target = root.querySelector<HTMLElement>(
      `[data-alpha-letter="${letter}"]`,
    )
    if (!target) return
    const rootRect = root.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    root.scrollTo({
      top: Math.max(0, root.scrollTop + (targetRect.top - rootRect.top) - 8),
      behavior: 'smooth',
    })
    setActiveWorkerLetter(letter)
  }

  function scrollCardlessToLetter(letter: string) {
    const root = cardlessScrollRef.current
    if (!root) return
    const target = root.querySelector<HTMLElement>(
      `[data-alpha-letter="${letter}"]`,
    )
    if (!target) return
    const rootRect = root.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    root.scrollTo({
      top: Math.max(0, root.scrollTop + (targetRect.top - rootRect.top) - 8),
      behavior: 'smooth',
    })
    setActiveCardlessLetter(letter)
  }

  const presentPeople = useMemo(() => {
    if (!data) return []
    return [...data.people]
      .filter(isPresent)
      .sort((a, b) => new Date(a.enteredAt).getTime() - new Date(b.enteredAt).getTime())
  }, [data])

  const filteredPresentPeople = useMemo(() => {
    if (!data) return []
    const query = listSearch.trim().toLowerCase()
    let list = [...presentPeople]

    if (listKindFilter === 'visitors') {
      list = list.filter((p) => p.kind === 'visitor')
    } else if (listKindFilter === 'workers_constant') {
      list = list.filter((p) => {
        if (p.kind !== 'named' || !p.workerId) return false
        const worker = data.workers.find((w) => w.id === p.workerId)
        return Boolean(worker && !worker.temporary)
      })
    } else if (listKindFilter === 'workers_temporary') {
      list = list.filter((p) => {
        if (p.kind !== 'named' || !p.workerId) return false
        const worker = data.workers.find((w) => w.id === p.workerId)
        return Boolean(worker?.temporary)
      })
    }

    if (query) {
      list = list.filter((p) => displayName(p).toLowerCase().includes(query))
    }
    if (listSort === 'name') {
      list.sort(comparePresentByName)
    } else if (listSort === 'time_desc') {
      list.sort(
        (a, b) =>
          new Date(b.enteredAt).getTime() - new Date(a.enteredAt).getTime(),
      )
    } else {
      list.sort(
        (a, b) =>
          new Date(a.enteredAt).getTime() - new Date(b.enteredAt).getTime(),
      )
    }
    return list
  }, [data, presentPeople, listSearch, listSort, listKindFilter])

  const listMaxColumns = useMemo(
    () => computeMaxColumns(filteredPresentPeople.length, false),
    [filteredPresentPeople.length, viewportTick],
  )

  const previewMaxColumns = useMemo(
    () => computeMaxColumns(filteredPresentPeople.length, true),
    [filteredPresentPeople.length, viewportTick],
  )

  const listColumnCount = resolveColumnCount(listColumnChoice, listMaxColumns)
  const previewColumnCount = resolveColumnCount(
    previewColumnChoice,
    previewMaxColumns,
  )

  const sortedBanned = useMemo(() => {
    if (!data) return []
    return [...data.banned].sort((a, b) =>
      bannedDisplayName(a).localeCompare(bannedDisplayName(b), 'he'),
    )
  }, [data])

  async function persist(next: AppData, message?: string) {
    setData(next)
    await saveData(next)
    if (message) setToast({ message })
  }

  const onShiftReportChange = useCallback((next: ShiftReport) => {
    setData((prev) => {
      if (!prev) return prev
      const shiftReportsArchive = upsertShiftInArchive(
        prev.shiftReportsArchive,
        next,
        prev.shiftReportTexts,
      )
      const updated = { ...prev, shiftReport: next, shiftReportsArchive }
      void saveData(updated)

      const nextShift = getNextShift(next.shift)
      if (nextShift) {
        const nextShiftReport = shiftReportsArchive[next.date.trim()]?.[nextShift]
        if (nextShiftReport) {
          void scheduleShiftReportAutoSave(
            updated.settings,
            nextShiftReport,
            updated.shiftReportTexts,
          )
        }
      }

      return updated
    })
  }, [])

  const onShiftContextChange = useCallback(
    (date: string, shift: ShiftKind, currentReport?: ShiftReport) => {
      setData((prev) => {
        if (!prev) return prev
        let shiftReportsArchive = prev.shiftReportsArchive
        const reportToSave = currentReport ?? prev.shiftReport
        if (reportToSave) {
          void flushShiftReportAutoSave(
            prev.settings,
            reportToSave,
            prev.shiftReportTexts,
          )
          shiftReportsArchive = upsertShiftInArchive(
            shiftReportsArchive,
            reportToSave,
            prev.shiftReportTexts,
          )
        }
        const shiftReport = getShiftFromArchive(
          shiftReportsArchive,
          date,
          shift,
          prev.shiftReportTexts,
        )
        const updated = { ...prev, shiftReportsArchive, shiftReport }
        void saveData(updated)
        return updated
      })
    },
    [],
  )

  const onShiftReportSettingsChange = useCallback(
    (partial: Partial<AppData['settings']>) => {
      setData((prev) => {
        if (!prev) return prev
        const updated = {
          ...prev,
          settings: { ...prev.settings, ...partial },
        }
        void saveData(updated)
        return updated
      })
    },
    [],
  )

  const onShiftReportTextsChange = useCallback((next: ShiftReportTexts) => {
    setData((prev) => {
      if (!prev) return prev
      const updated = {
        ...prev,
        shiftReportTexts: normalizeShiftReportTexts(next),
      }
      void saveData(updated)
      if (updated.shiftReport) {
        void scheduleShiftReportAutoSave(
          updated.settings,
          updated.shiftReport,
          updated.shiftReportTexts,
        )
      }
      return updated
    })
  }, [])

  function clearManageMode() {
    setManageMode('none')
    setEditingWorker(null)
    setEditingCardless(null)
  }

  function clearCardlessSelection() {
    setSelectedCardlessId(null)
  }

  function onEditModeClick() {
    setManageMode((m) => (m === 'edit' ? 'none' : 'edit'))
    setEditingWorker(null)
    setEditingCardless(null)
    clearCardlessSelection()
  }

  function onDeleteModeClick() {
    setManageMode((m) => (m === 'delete' ? 'none' : 'delete'))
    setEditingWorker(null)
    setEditingCardless(null)
    clearCardlessSelection()
  }

  async function addWorkerToSite(worker: Worker) {
    if (!data) return
    clearManageMode()
    if (isWorkerPresent(data, worker.id)) {
      setToast({ message: `${workerDisplayName(worker)} כבר באתר` })
      return
    }
    const entry: PersonEntry = {
      id: createId(),
      kind: 'named',
      workerId: worker.id,
      cardlessPersonId: null,
      firstName: worker.firstName,
      lastName: worker.lastName,
      visitorNumber: null,
      enteredAt: new Date().toISOString(),
      exitedAt: null,
    }
    await persist(
      { ...data, people: [entry, ...data.people] },
      `${workerDisplayName(worker)} נוסף/ה`,
    )
  }

  async function addVisitorToSite(
    visitorNumber: number,
    names?: { firstName: string; lastName: string },
  ) {
    if (!data) return
    if (isVisitorPresent(data, visitorNumber)) {
      setToast({ message: `ויזיטור ${visitorNumber} כבר באתר` })
      return
    }
    const firstName = names?.firstName.trim() ?? ''
    const lastName = names?.lastName.trim() ?? ''
    const entry: PersonEntry = {
      id: createId(),
      kind: 'visitor',
      workerId: null,
      cardlessPersonId: null,
      firstName,
      lastName,
      visitorNumber,
      enteredAt: new Date().toISOString(),
      exitedAt: null,
    }
    const nameLabel = `${firstName} ${lastName}`.trim()
    await persist(
      { ...data, people: [entry, ...data.people] },
      nameLabel
        ? `ויזיטור ${visitorNumber} · ${nameLabel} נוסף`
        : `ויזיטור ${visitorNumber} נוסף`,
    )
  }

  function resetNewWorkerForm() {
    setNewWorker(emptyNamed)
    setNewWorkerTemporary(false)
  }

  function resetNewCardlessForm() {
    setNewCardless(emptyNamed)
    setNewCardlessTemporary(false)
    setNewCardlessAssignment('unique')
  }

  async function createNewCardless(e: FormEvent) {
    e.preventDefault()
    if (!data) return
    const firstName = newCardless.firstName.trim()
    const lastName = newCardless.lastName.trim()
    if (!firstName) {
      setToast({ message: 'שם פרטי חובה' })
      return
    }

    const exists = data.cardlessPeople.some(
      (c) =>
        c.firstName.toLowerCase() === firstName.toLowerCase() &&
        c.lastName.toLowerCase() === lastName.toLowerCase(),
    )
    if (exists) {
      setToast({ message: 'השם כבר קיים ברשימה' })
      return
    }

    const temporary = newCardlessTemporary
    const person: CardlessPerson = {
      id: createId(),
      firstName,
      lastName,
      temporary,
      expiresAt: temporary ? endOfTodayMidnight() : null,
      assignment: newCardlessAssignment,
    }
    const display = cardlessDisplayName(person)
    const assignLabel =
      newCardlessAssignment === 'unique' ? 'יחיד' : 'מרובה'
    await persist(
      {
        ...data,
        cardlessPeople: [person, ...data.cardlessPeople],
      },
      temporary
        ? `${display} נוסף (${assignLabel} · נמחק בחצות)`
        : `${display} נוסף (${assignLabel})`,
    )
    setShowNewCardless(false)
    resetNewCardlessForm()
  }

  async function removeCardlessPerson(person: CardlessPerson) {
    if (!data) return
    await persist(
      {
        ...data,
        cardlessPeople: data.cardlessPeople.filter((c) => c.id !== person.id),
      },
      `${cardlessDisplayName(person)} הוסר מהרשימה`,
    )
  }

  async function onCardlessNameClick(person: CardlessPerson) {
    if (!data) return
    if (manageMode === 'edit') {
      setEditingCardless({ ...person })
      return
    }
    if (manageMode === 'delete') {
      await removeCardlessPerson(person)
      if (selectedCardlessId === person.id) clearCardlessSelection()
      return
    }
    if (isCardlessBlocked(data, person)) {
      setToast({ message: `${cardlessDisplayName(person)} כבר באתר (יחיד)` })
      return
    }
    setSelectedCardlessId((prev) => (prev === person.id ? null : person.id))
  }

  async function saveEditedCardless(e: FormEvent) {
    e.preventDefault()
    if (!data || !editingCardless) return
    const firstName = editingCardless.firstName.trim()
    const lastName = editingCardless.lastName.trim()
    if (!firstName) {
      setToast({ message: 'שם פרטי חובה' })
      return
    }

    const duplicate = data.cardlessPeople.some(
      (c) =>
        c.id !== editingCardless.id &&
        c.firstName.toLowerCase() === firstName.toLowerCase() &&
        c.lastName.toLowerCase() === lastName.toLowerCase(),
    )
    if (duplicate) {
      setToast({ message: 'שם זה כבר קיים ברשימה' })
      return
    }

    const assignment: CardlessAssignment =
      editingCardless.assignment === 'unique' ||
      editingCardless.assignment === 'multiple'
        ? editingCardless.assignment
        : 'multiple'
    const temporary = Boolean(editingCardless.temporary)
    const updated: CardlessPerson = {
      ...editingCardless,
      firstName,
      lastName,
      assignment,
      temporary,
      expiresAt: temporary ? endOfTodayMidnight() : null,
    }
    const nextCardless = data.cardlessPeople.map((c) =>
      c.id === editingCardless.id ? updated : c,
    )
    await persist(
      { ...data, cardlessPeople: nextCardless },
      'השם עודכן',
    )
    setEditingCardless(null)
    if (assignment === 'unique' && isCardlessBlocked(data, updated)) {
      clearCardlessSelection()
    }
  }

  async function affiliateCardlessToVisitor(
    person: CardlessPerson,
    visitorNumber: number,
  ) {
    if (!data) return
    if (isCardlessBlocked(data, person)) {
      setToast({ message: `${cardlessDisplayName(person)} כבר באתר (יחיד)` })
      clearCardlessSelection()
      return
    }
    if (!isVisitorNumberOpen(data, visitorNumber)) {
      setToast({ message: `ויזיטור ${visitorNumber} סגור` })
      return
    }
    if (isVisitorPresent(data, visitorNumber)) {
      setToast({ message: `ויזיטור ${visitorNumber} כבר באתר` })
      return
    }
    const firstName = person.firstName.trim()
    const lastName = person.lastName.trim()
    const entry: PersonEntry = {
      id: createId(),
      kind: 'visitor',
      workerId: null,
      cardlessPersonId: person.id,
      firstName,
      lastName,
      visitorNumber,
      enteredAt: new Date().toISOString(),
      exitedAt: null,
    }
    const display = cardlessDisplayName(person)
    await persist(
      { ...data, people: [entry, ...data.people] },
      `ויזיטור ${visitorNumber} · ${display} נוסף`,
    )
    clearCardlessSelection()
  }

  async function createNewWorker(e: FormEvent) {
    e.preventDefault()
    if (!data) return
    const firstName = newWorker.firstName.trim()
    const lastName = newWorker.lastName.trim()
    if (!firstName) {
      setToast({ message: 'שם פרטי חובה' })
      return
    }

    const exists = data.workers.some(
      (w) =>
        w.firstName.toLowerCase() === firstName.toLowerCase() &&
        w.lastName.toLowerCase() === lastName.toLowerCase(),
    )
    if (exists) {
      setToast({ message: 'העובד כבר קיים ברשימה' })
      return
    }

    const temporary = newWorkerTemporary
    const worker: Worker = {
      id: createId(),
      firstName,
      lastName,
      temporary,
      expiresAt: temporary ? endOfTodayMidnight() : null,
    }
    const entry: PersonEntry = {
      id: createId(),
      kind: 'named',
      workerId: worker.id,
      cardlessPersonId: null,
      firstName,
      lastName,
      visitorNumber: null,
      enteredAt: new Date().toISOString(),
      exitedAt: null,
    }

    const display = `${firstName} ${lastName}`.trim()
    await persist(
      {
        ...data,
        workers: [...data.workers, worker],
        people: [entry, ...data.people],
      },
      temporary
        ? `${display} נוסף (זמני עד חצות)`
        : `${display} נוסף (קבוע)`,
    )
    setShowNewWorker(false)
    resetNewWorkerForm()
  }

  async function onWorkerCardClick(worker: Worker) {
    if (manageMode === 'edit') {
      setEditingWorker({ ...worker })
      return
    }
    if (manageMode === 'delete') {
      await removeWorkerFromRoster(worker)
      return
    }
    await addWorkerToSite(worker)
  }

  async function saveEditedWorker(e: FormEvent) {
    e.preventDefault()
    if (!data || !editingWorker) return
    const firstName = editingWorker.firstName.trim()
    const lastName = editingWorker.lastName.trim()
    if (!firstName) {
      setToast({ message: 'שם פרטי חובה' })
      return
    }

    const duplicate = data.workers.some(
      (w) =>
        w.id !== editingWorker.id &&
        w.firstName.toLowerCase() === firstName.toLowerCase() &&
        w.lastName.toLowerCase() === lastName.toLowerCase(),
    )
    if (duplicate) {
      setToast({ message: 'עובד עם שם זה כבר קיים' })
      return
    }

    const temporary = Boolean(editingWorker.temporary)
    const updated: Worker = {
      ...editingWorker,
      firstName,
      lastName,
      temporary,
      expiresAt: temporary ? endOfTodayMidnight() : null,
    }
    const nextWorkers = data.workers.map((w) =>
      w.id === editingWorker.id ? updated : w,
    )
    const nextPeople = data.people.map((p) =>
      p.workerId === editingWorker.id ? { ...p, firstName, lastName } : p,
    )
    await persist(
      { ...data, workers: nextWorkers, people: nextPeople },
      'העובד עודכן',
    )
    setEditingWorker(null)
  }

  async function removeWorkerFromRoster(worker: Worker) {
    if (!data) return
    if (
      !window.confirm(
        `למחוק את ${workerDisplayName(worker)} מהרשימה?\n(אם הוא באתר, הוא יוסר גם משם.)`,
      )
    ) {
      return
    }
    await persist(
      {
        ...data,
        workers: data.workers.filter((w) => w.id !== worker.id),
        people: data.people.filter((p) => p.workerId !== worker.id),
      },
      'העובד נמחק',
    )
  }

  async function markExit(id: string) {
    if (!data) return
    const person = data.people.find((p) => p.id === id)
    if (!person) return
    await persist(
      { ...data, people: data.people.filter((p) => p.id !== id) },
      `${displayName(person)} הוסר מהאתר`,
    )
  }

  async function setVisitorSlotAccess(
    visitorNumber: number,
    mode: VisitorAccess,
  ) {
    if (!data) return
    const key = String(visitorNumber)
    const visitorSlots = {
      ...normalizeData(data).settings.visitorSlots,
      [key]: {
        access: mode,
        openUntil: mode === 'open_temp' ? endOfTodayMidnight() : null,
      },
    }
    await persist({
      ...data,
      settings: { ...data.settings, visitorSlots },
    })
  }

  async function applyVisitorModeToAll(mode: VisitorAccess) {
    if (!data) return
    const visitorSlots = { ...normalizeData(data).settings.visitorSlots }
    const openUntil = mode === 'open_temp' ? endOfTodayMidnight() : null
    for (let n = 1; n <= VISITOR_COUNT; n++) {
      visitorSlots[String(n)] = { access: mode, openUntil }
    }
    const labels: Record<VisitorAccess, string> = {
      closed: 'כל הויזיטורים נסגרו',
      open_temp: 'כל הויזיטורים פתוחים עד חצות',
      open_constant: 'כל הויזיטורים פתוחים קבוע',
    }
    await persist(
      { ...data, settings: { ...data.settings, visitorSlots } },
      labels[mode],
    )
  }

  function resetBannedForm() {
    setNewBanned(emptyBanned)
  }

  async function createBannedPerson(e: FormEvent) {
    e.preventDefault()
    if (!data) return
    const firstName = newBanned.firstName.trim()
    const lastName = newBanned.lastName.trim()
    const reason = newBanned.reason.trim()
    const plateNumber = newBanned.plateNumber.trim()
    const idNumber = newBanned.idNumber.trim()
    if (!firstName || !lastName) {
      setToast({ message: 'שם פרטי ושם משפחה חובה' })
      return
    }

    const exists = data.banned.some(
      (b) =>
        b.firstName.toLowerCase() === firstName.toLowerCase() &&
        b.lastName.toLowerCase() === lastName.toLowerCase(),
    )
    if (exists) {
      setToast({ message: 'האדם כבר ברשימת האסורים' })
      return
    }

    const person: BannedPerson = {
      id: createId(),
      firstName,
      lastName,
      reason,
      plateNumber,
      idNumber,
      addedAt: new Date().toISOString(),
    }
    await persist(
      { ...data, banned: [...data.banned, person] },
      `${bannedDisplayName(person)} נוסף לרשימת האסורים`,
    )
    setShowBannedModal(false)
    resetBannedForm()
  }

  async function saveEditedBanned(e: FormEvent) {
    e.preventDefault()
    if (!data || !editingBanned) return
    const firstName = editingBanned.firstName.trim()
    const lastName = editingBanned.lastName.trim()
    const reason = editingBanned.reason.trim()
    const plateNumber = editingBanned.plateNumber.trim()
    const idNumber = editingBanned.idNumber.trim()
    if (!firstName || !lastName) {
      setToast({ message: 'שם פרטי ושם משפחה חובה' })
      return
    }

    const duplicate = data.banned.some(
      (b) =>
        b.id !== editingBanned.id &&
        b.firstName.toLowerCase() === firstName.toLowerCase() &&
        b.lastName.toLowerCase() === lastName.toLowerCase(),
    )
    if (duplicate) {
      setToast({ message: 'אדם עם שם זה כבר קיים ברשימה' })
      return
    }

    const nextBanned = data.banned.map((b) =>
      b.id === editingBanned.id
        ? {
            ...editingBanned,
            firstName,
            lastName,
            reason,
            plateNumber,
            idNumber,
          }
        : b,
    )
    await persist({ ...data, banned: nextBanned }, 'הרשומה עודכנה')
    setEditingBanned(null)
  }

  async function removeBannedPerson(person: BannedPerson) {
    if (!data) return
    if (
      !window.confirm(
        `להסיר את ${bannedDisplayName(person)} מרשימת האסורים?`,
      )
    ) {
      return
    }
    await persist(
      { ...data, banned: data.banned.filter((b) => b.id !== person.id) },
      'הרשומה הוסרה',
    )
  }

  async function copyEmergencyFallback(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  }

  async function captureListImageDataUrl(): Promise<string | null> {
    const visiblePage = document.querySelector(
      '.preview-share-wrap .preview-pdf-page',
    ) as HTMLElement | null
    const fallbackRoot = shareRef.current
    const source =
      visiblePage ||
      (fallbackRoot?.querySelector('.preview-pdf-page') as HTMLElement | null) ||
      fallbackRoot

    if (!source) return null

    const host = document.createElement('div')
    host.setAttribute('data-capture-host', '1')
    host.style.cssText = [
      'position:fixed',
      'left:0',
      'top:0',
      'z-index:2147483647',
      'background:#ffffff',
      'padding:0',
      'margin:0',
      'opacity:1',
      'filter:none',
      'pointer-events:none',
      'transform:none',
    ].join(';')

    const clone = source.cloneNode(true) as HTMLElement
    clone.style.width = `${Math.max(source.scrollWidth, source.clientWidth, 900)}px`
    clone.style.maxWidth = 'none'
    clone.style.height = 'auto'
    clone.style.maxHeight = 'none'
    clone.style.overflow = 'visible'
    clone.style.opacity = '1'
    clone.style.filter = 'none'
    clone.style.background = '#ffffff'
    clone.style.boxShadow = 'none'
    clone.style.border = 'none'
    clone.style.transform = 'none'

    clone
      .querySelectorAll<HTMLElement>('.people.doc-scroll-list, .list-capture, .people')
      .forEach((node) => {
        node.style.overflow = 'visible'
        node.style.maxHeight = 'none'
        node.style.height = 'auto'
        node.style.opacity = '1'
        node.style.filter = 'none'
      })

    clone.querySelectorAll<HTMLElement>('*').forEach((node) => {
      node.style.animation = 'none'
      node.style.transition = 'none'
    })

    host.appendChild(clone)
    document.body.appendChild(host)

    try {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
      return await domToPng(clone, {
        backgroundColor: '#ffffff',
        scale: Math.min(2, window.devicePixelRatio || 2),
        quality: 1,
        style: {
          opacity: '1',
          filter: 'none',
          transform: 'none',
        },
      })
    } catch {
      return null
    } finally {
      host.remove()
    }
  }

  async function sendEmergencyList() {
    if (!data) return
    const phones = emergencyDialPhones(data.settings.emergencyPhones ?? [])
    if (phones.length === 0) {
      setToast({
        message: 'הוסיפו לפחות מספר אחד מסומן כ«חירום» ב«מספרים»',
      })
      setShowEmergencyPhones(true)
      return
    }

    setBusy(true)
    try {
      const present = data.people.filter(isPresent)
      const text = buildEmergencyMessage(data, present)
      const listImage = await captureListImageDataUrl()

      const browserOnline =
        typeof navigator !== 'undefined' ? navigator.onLine : true
      if (!browserOnline || !whatsappStatus.online) {
        const copied = await copyEmergencyFallback(text)
        setToast({
          message: copied
            ? 'אין אינטרנט — ההודעה הועתקה. שלחו ידנית כשיחזור החיבור'
            : 'אין אינטרנט — לא ניתן לשלוח חירום כרגע',
        })
        return
      }

      if (window.listeApi?.getWhatsAppStatus) {
        const status = await window.listeApi.getWhatsAppStatus()
        setWhatsappStatus(status)
        if (!status.online) {
          const copied = await copyEmergencyFallback(text)
          setToast({
            message: copied
              ? 'אין אינטרנט — ההודעה הועתקה. שלחו ידנית כשיחזור החיבור'
              : 'אין אינטרנט — לא ניתן לשלוח חירום כרגע',
          })
          return
        }
        // Bloquer seulement si écran QR / login clairement détecté
        if (
          status.detail === 'web_login' ||
          status.detail === 'desktop_login'
        ) {
          const copied = await copyEmergencyFallback(text)
          const label = whatsappStatusLabel(status)
          setToast({
            message: copied
              ? `${label ?? 'WhatsApp לא מחובר'} — ההודעה הועתקה`
              : label ?? 'WhatsApp לא מחובר',
          })
          return
        }
      }

      if (window.listeApi?.sendWhatsAppText) {
        const result = await window.listeApi.sendWhatsAppText(
          phones,
          text,
          listImage ?? undefined,
        )
        const ok = typeof result === 'boolean' ? result : result.ok
        const error = typeof result === 'boolean' ? undefined : result.error
        if (!ok) {
          if (error === 'offline') {
            setToast({
              message:
                'אין אינטרנט — ההודעה הועתקה. שלחו ידנית כשיחזור החיבור',
            })
          } else if (error === 'whatsapp_not_connected') {
            setToast({
              message:
                'WhatsApp Web לא מחובר — ההודעה הועתקה. התחברו ב־web.whatsapp.com ושלחו ידנית',
            })
          } else if (error === 'whatsapp_unavailable') {
            setToast({
              message:
                'לא ניתן לפתוח WhatsApp Web — ההודעה הועתקה. פתחו את הדפדפן ושלחו ידנית',
            })
          } else {
            setToast({ message: 'שליחת החירום נכשלה' })
          }
          return
        }
      } else {
        for (const phone of phones) {
          const phoneNorm = normalizeWhatsAppPhone(phone)
          if (!phoneNorm) continue
          window.open(
            `https://wa.me/${phoneNorm}?text=${encodeURIComponent(text)}`,
            '_blank',
          )
        }
      }
      setToast({
        message:
          phones.length === 1
            ? listImage
              ? 'הודעת החירום והתמונה נשלחות ב־WhatsApp…'
              : 'הרשימה נשלחת אוטומטית ב־WhatsApp…'
            : listImage
              ? `הודעת החירום והתמונה נשלחות ל־${phones.length} מספרים…`
              : `הרשימה נשלחת אוטומטית ל־${phones.length} מספרים…`,
      })
    } catch {
      setToast({ message: 'שגיאה בשליחת הודעת החירום' })
    } finally {
      setBusy(false)
    }
  }

  function resetPhoneForm() {
    setEmergencyPhoneDraft('')
    setEmergencyNameDraft('')
    setEmergencyFlagDraft(true)
  }

  async function addEmergencyPhone(e: FormEvent) {
    e.preventDefault()
    if (!data) return
    const phone = emergencyPhoneDraft.trim()
    const name = emergencyNameDraft.trim()
    if (!normalizeWhatsAppPhone(phone)) {
      setToast({ message: 'נא להזין מספר טלפון תקין' })
      return
    }
    const key = normalizeWhatsAppPhone(phone)
    const current = data.settings.emergencyPhones ?? []
    if (current.some((p) => normalizeWhatsAppPhone(p.phone) === key)) {
      setToast({ message: 'המספר כבר ברשימה' })
      return
    }
    const contact: ContactPhone = {
      id: createId(),
      name,
      phone,
      emergency: emergencyFlagDraft,
    }
    const emergencyPhones = [...current, contact]
    resetPhoneForm()
    await persist(
      {
        ...data,
        settings: {
          ...data.settings,
          emergencyPhones,
          directorPhone: emergencyPhones[0]?.phone ?? '',
        },
      },
      'המספר נוסף',
    )
  }

  async function removeEmergencyPhone(contactId: string) {
    if (!data) return
    const emergencyPhones = (data.settings.emergencyPhones ?? []).filter(
      (p) => p.id !== contactId,
    )
    await persist(
      {
        ...data,
        settings: {
          ...data.settings,
          emergencyPhones,
          directorPhone: emergencyPhones[0]?.phone ?? '',
        },
      },
      'המספר הוסר',
    )
  }

  async function toggleContactEmergency(contactId: string) {
    if (!data) return
    const emergencyPhones = (data.settings.emergencyPhones ?? []).map((c) =>
      c.id === contactId ? { ...c, emergency: !c.emergency } : c,
    )
    await persist(
      {
        ...data,
        settings: {
          ...data.settings,
          emergencyPhones,
          directorPhone: emergencyPhones[0]?.phone ?? '',
        },
      },
      'עודכן',
    )
  }

  function openShareTargetPicker() {
    const phones = data?.settings.emergencyPhones ?? []
    setSharePhoneDraft(phones[0]?.phone ?? '')
    setShowShareTarget(true)
  }

  /** שליחה ישירה לפי מספר (בלי בחירה בתוך WhatsApp) */
  async function shareListOnWhatsAppToPhone(phoneRaw: string) {
    if (!data) return
    const phone = phoneRaw.trim()
    if (!normalizeWhatsAppPhone(phone)) {
      setToast({ message: 'מספר לא תקין' })
      return
    }

    setShowShareTarget(false)
    setBusy(true)
    try {
      const dataUrl = await captureListImageDataUrl()
      if (!dataUrl) {
        setToast({ message: 'שגיאה ביצירת התמונה' })
        return
      }

      if (window.listeApi?.sendWhatsAppText) {
        setToast({ message: 'שולח את התמונה ב־WhatsApp…' })
        const result = await window.listeApi.sendWhatsAppText(
          phone,
          '',
          dataUrl,
        )
        const ok = typeof result === 'boolean' ? result : result.ok
        const error = typeof result === 'boolean' ? undefined : result.error
        if (!ok) {
          if (error === 'whatsapp_not_connected') {
            setToast({
              message:
                'WhatsApp Web לא מחובר — לחצו על מצב החיבור וסרקו QR. התמונה הועתקה',
            })
            void window.listeApi.copyImage?.(dataUrl)
            void window.listeApi.openWhatsAppWebSession?.()
          } else if (error === 'offline') {
            setToast({ message: 'אין אינטרנט — לא ניתן לשלוח כרגע' })
          } else {
            setToast({ message: 'שליחת התמונה נכשלה' })
          }
          return
        }
        setToast({ message: 'התמונה נשלחה ב־WhatsApp' })
        return
      }

      // Fallback דפדפן / בלי API שליחה
      if (window.listeApi?.shareImageToWhatsApp) {
        const result = await window.listeApi.shareImageToWhatsApp(dataUrl)
        const ok = typeof result === 'boolean' ? result : result.ok
        setToast({
          message: ok
            ? 'בחרו איש קשר ב־WhatsApp — התמונה תודבק'
            : 'שיתוף התמונה נכשל',
        })
        return
      }

      const blob = await (await fetch(dataUrl)).blob()
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ])
      const phoneNorm = normalizeWhatsAppPhone(phone)
      window.open(
        `https://web.whatsapp.com/send?phone=${phoneNorm}`,
        '_blank',
      )
      setToast({ message: 'התמונה הועתקה — הדביקו (Ctrl+V) ושלחו' })
    } catch {
      setToast({ message: 'שגיאה בשליחת התמונה' })
    } finally {
      setBusy(false)
    }
  }

  if (!data) {
    return (
      <div className="app-root">
        <div className="app-shell app-loading">
          <p className="empty">טוען…</p>
        </div>
      </div>
    )
  }

  const renderPresenceListBody = (
    people: typeof presentPeople,
    options?: {
      showActions?: boolean
      showFilters?: boolean
      layout?: ListLayout
      columnCount?: number
      columnChoice?: ColumnChoice
      onColumnChoiceChange?: (value: ColumnChoice) => void
    },
  ) => {
    const showActions = options?.showActions !== false
    const showFilters = options?.showFilters === true
    const layout = options?.layout ?? 'rows'
    const isDocument = !showActions
    const preferColumns = layout === 'columns'
    const columnCount = Math.min(
      COLUMN_CHOICE_MAX,
      Math.max(1, options?.columnCount ?? 1),
    )
    const docColsClass = preferColumns
      ? isDocument
        ? 'doc-columns'
        : 'layout-columns'
      : isDocument
        ? 'doc-cols-1 doc-scroll-list'
        : 'layout-rows'
    const docCompact =
      (isDocument || preferColumns) && people.length > 12 ? 'doc-compact' : ''
    const columnsStyle = preferColumns
      ? ({
          gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
        } as const)
      : undefined

    return (
    <>
      <div className="list-capture-header">
        <h2>רשימת נוכחים</h2>
        {showFilters && (
          <div className="list-toolbar">
            <div className="search-field list-search-field">
              <IconSearch />
              <input
                type="search"
                className="list-search"
                value={listSearch}
                onChange={(e) => setListSearch(e.target.value)}
                placeholder="חיפוש לפי שם…"
                aria-label="חיפוש לפי שם"
              />
            </div>
            <FancySelect
              className="list-sort-picker"
              triggerClassName="list-sort-trigger"
              ariaLabel="מיון הרשימה"
              value={listSort}
              options={[
                { value: 'time_asc', label: 'שעה · מוקדם תחילה' },
                { value: 'time_desc', label: 'שעה · מאוחר תחילה' },
                { value: 'name', label: 'סדר אלפביתי' },
              ]}
              onChange={(v) => setListSort(v as ListSort)}
            />
            <FancySelect
              className="list-kind-picker"
              triggerClassName="list-kind-trigger"
              ariaLabel="סינון לפי סוג"
              value={listKindFilter}
              options={[
                { value: 'all', label: 'הכל' },
                { value: 'visitors', label: 'ויזיטורים' },
                { value: 'workers_constant', label: 'עובדים קבועים' },
                { value: 'workers_temporary', label: 'עובדים זמניים' },
              ]}
              onChange={(v) => setListKindFilter(v as ListKindFilter)}
            />
            <div className="list-layout-controls">
              <div className="list-layout-toggle" role="group" aria-label="תצוגת רשימה">
                <button
                  type="button"
                  className={`layout-icon-btn ${layout === 'rows' ? 'active' : ''}`}
                  onClick={() => setListLayout('rows')}
                  title="רשימה גלילה"
                  aria-label="רשימה גלילה"
                >
                  <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                    <rect x="2" y="3" width="16" height="3" rx="1" fill="currentColor" />
                    <rect x="2" y="8.5" width="16" height="3" rx="1" fill="currentColor" />
                    <rect x="2" y="14" width="16" height="3" rx="1" fill="currentColor" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={`layout-icon-btn ${layout === 'columns' ? 'active' : ''}`}
                  onClick={() => setListLayout('columns')}
                  title="תצוגה בעמודות"
                  aria-label="תצוגה בעמודות"
                >
                  <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                    <rect x="2" y="2" width="7" height="16" rx="1.5" fill="currentColor" />
                    <rect x="11" y="2" width="7" height="16" rx="1.5" fill="currentColor" />
                  </svg>
                </button>
              </div>
              {options?.onColumnChoiceChange && (
                <div
                  className={`column-count-slot ${preferColumns ? 'is-visible' : 'is-hidden'}`}
                  aria-hidden={!preferColumns}
                >
                  <ColumnCountPicker
                    choice={options.columnChoice ?? 'max'}
                    onChange={options.onColumnChoiceChange}
                  />
                </div>
              )}
            </div>
          </div>
        )}
        <div className="list-datetime">
          <span>
            {new Date().toLocaleDateString('he-IL', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
            })}
          </span>
          <span>
            {new Date().toLocaleTimeString('he-IL', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
      </div>

      {people.length === 0 ? (
        <div className="empty main-people">
          {showFilters &&
          listKindFilter !== 'all' &&
          presentPeople.length > 0 &&
          people.length === 0
            ? 'אין תוצאות לסינון שנבחר.'
            : showFilters && listSearch.trim() && presentPeople.length > 0
            ? 'לא נמצאו תוצאות לחיפוש.'
            : 'אין אף אחד באתר כרגע.'}
        </div>
      ) : (
        <div
          className={`people main-people ${docColsClass} ${docCompact}`.trim()}
          style={columnsStyle}
          data-cols={preferColumns ? columnCount : undefined}
        >
          {people.map((person, index) => {
            let accentClass = ''
            let isFixedWorker = false
            if (person.kind === 'visitor' && person.visitorNumber != null && data) {
              const slot = getVisitorSlot(data, person.visitorNumber)
              const open = isVisitorNumberOpen(data, person.visitorNumber)
              if (open && slot.access === 'open_constant') {
                accentClass = 'is-visitor-open'
              } else if (open && slot.access === 'open_temp') {
                accentClass = 'is-visitor-temp'
              }
            } else if (person.kind === 'named' && person.workerId && data) {
              const worker = data.workers.find((w) => w.id === person.workerId)
              if (worker?.temporary) {
                accentClass = 'is-temporary'
              } else if (worker) {
                isFixedWorker = true
              }
            }
            const lateFixed =
              isFixedWorker && isEnteredAfterSevenAm(person.enteredAt)
            const timeText = isDocument
              ? formatTime(person.enteredAt)
              : formatDateTime(person.enteredAt)

            const affiliated =
              person.kind === 'visitor' ? visitorAffiliatedName(person) : ''
            const visitorLabel =
              person.kind === 'visitor' && person.visitorNumber != null
                ? `ויזיטור ${person.visitorNumber}`
                : ''
            const primaryLabel = affiliated
              ? affiliated
              : visitorLabel || displayName(person)
            const subLabel = affiliated ? visitorLabel : ''

            return (
            <article key={person.id} className={`person ${accentClass}`.trim()}>
              <div className="person-main">
                <div className="person-name">
                  <span className="person-index">{index + 1}.</span>
                  {primaryLabel}
                </div>
                {subLabel ? (
                  <div className="person-subname">{subLabel}</div>
                ) : null}
                <div className="person-meta">
                  כניסה{' '}
                  <span className={lateFixed ? 'time-late' : undefined}>
                    {timeText}
                  </span>
                  {accentClass === 'is-temporary' ? ' · זמני' : ''}
                  {accentClass === 'is-visitor-temp' ? ' · הרשאה זמנית' : ''}
                  {accentClass === 'is-visitor-open' ? ' · הרשאה קבועה' : ''}
                </div>
              </div>
              {showActions && (
                <div className="person-actions">
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => markExit(person.id)}
                  >
                    הסרה
                  </button>
                </div>
              )}
            </article>
            )
          })}
        </div>
      )}

      <div className="list-capture-footer">
        <div className="list-bar" aria-hidden="true" />
        <div className="list-total">
          סה״כ באתר: {presentCount}
          {showFilters &&
          people.length !== presentCount &&
          (listSearch.trim() || listKindFilter !== 'all')
            ? ` · מוצגים: ${people.length}`
            : ''}
        </div>
      </div>
    </>
    )
  }

  const renderPdfDocument = () => (
    <div className="preview-pdf-page">
      <div className="preview-pdf-brand" dir="ltr">
        <img
          src={chevronLogo}
          alt="Chevron"
          className="preview-pdf-logo"
        />
        <div className="preview-pdf-brand-text">
          <strong>Chevron</strong>
          <span>רשימת נוכחים באתר</span>
        </div>
      </div>
      <div className="preview-pdf-rule" aria-hidden="true" />
      <div className="list-capture capturing list-capture-expanded list-capture-document">
        {renderPresenceListBody(filteredPresentPeople, {
          showActions: false,
          layout: previewLayout,
          columnCount: previewColumnCount,
        })}
      </div>
      <div className="preview-pdf-footer-note">
        מסמך זה נוצר אוטומטית ממערכת רשימת הנוכחים
      </div>
    </div>
  )

  return (
    <div className="app-root">
      <header className="top-brand" dir="ltr">
        <img
          src={chevronLogo}
          alt="Chevron"
          className="brand-logo"
        />
        <div className="brand-divider" />
        <div className="brand-text">
          <strong>Chevron</strong>
          <span>רשימת נוכחים באתר</span>
        </div>
        <button
          type="button"
          className={`app-version ${updateChecking ? 'checking' : ''}`}
          onClick={() => void checkUpdatesFromBadge()}
          title="לחצו לבדיקת עדכונים"
          disabled={updateChecking}
        >
          {updateChecking ? 'בודק…' : `v${__APP_VERSION__}`}
        </button>
        <nav className="app-tabs" aria-label="ניווט ראשי">
          <button
            type="button"
            className={`app-tab app-tab-banned ${activeTab === 'banned' ? 'active' : ''}`}
            onClick={() => {
              clearManageMode()
              setActiveTab('banned')
            }}
          >
            רשימת אסורים
          </button>
          <button
            type="button"
            className={`app-tab ${activeTab === 'presence' ? 'active' : ''}`}
            onClick={() => {
              clearManageMode()
              setActiveTab('presence')
            }}
          >
            רשימת נוכחים
          </button>
          <button
            type="button"
            className={`app-tab ${activeTab === 'cameras' ? 'active' : ''}`}
            onClick={() => {
              clearManageMode()
              setActiveTab('cameras')
            }}
          >
            דוח מצלמות
          </button>
          <button
            type="button"
            className={`app-tab ${activeTab === 'shift' ? 'active' : ''}`}
            onClick={() => {
              clearManageMode()
              setActiveTab('shift')
            }}
          >
            דוח משמרת
          </button>
        </nav>
      </header>

      <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {activeTab === 'presence' && (
        <>
      <aside className="sidebar" aria-hidden={sidebarCollapsed}>
        <div className="sidebar-header">
          <h2>הוספת כניסה</h2>
          <div className="header-actions">
            {sidebarRoster === 'workers' ? (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ width: 'auto' }}
                  onClick={() => {
                    clearManageMode()
                    setShowNewWorker(true)
                  }}
                >
                  + עובד חדש
                </button>
                <button
                  type="button"
                  className={`btn btn-edit ${manageMode === 'edit' ? 'mode-active' : ''}`}
                  onClick={onEditModeClick}
                  disabled={sortedWorkers.length === 0}
                >
                  <IconEdit />
                  <span>עריכה</span>
                </button>
                <button
                  type="button"
                  className={`btn btn-danger ${manageMode === 'delete' ? 'mode-active' : ''}`}
                  onClick={onDeleteModeClick}
                  disabled={sortedWorkers.length === 0}
                >
                  <IconTrash />
                  <span>מחיקה</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ width: 'auto' }}
                  onClick={() => {
                    clearManageMode()
                    setShowNewCardless(true)
                  }}
                >
                  + שם חדש
                </button>
                <button
                  type="button"
                  className={`btn btn-edit ${manageMode === 'edit' ? 'mode-active' : ''}`}
                  onClick={onEditModeClick}
                  disabled={(data?.cardlessPeople.length ?? 0) === 0}
                >
                  <IconEdit />
                  <span>עריכה</span>
                </button>
                <button
                  type="button"
                  className={`btn btn-danger ${manageMode === 'delete' ? 'mode-active' : ''}`}
                  onClick={onDeleteModeClick}
                  disabled={(data?.cardlessPeople.length ?? 0) === 0}
                >
                  <IconTrash />
                  <span>מחיקה</span>
                </button>
              </>
            )}
          </div>
        </div>

        <div className="sidebar-roster-badges" role="tablist" aria-label="בחירת רשימה צדדית">
          <button
            type="button"
            role="tab"
            aria-selected={sidebarRoster === 'workers'}
            className={`sidebar-roster-badge ${
              sidebarRoster === 'workers' ? 'active' : ''
            }`}
            onClick={() => {
              clearManageMode()
              clearCardlessSelection()
              setSidebarRoster('workers')
            }}
          >
            עובדים
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sidebarRoster === 'visitors'}
            className={`sidebar-roster-badge ${
              sidebarRoster === 'visitors' ? 'active' : ''
            }`}
            onClick={() => {
              clearManageMode()
              clearCardlessSelection()
              setSidebarRoster('visitors')
            }}
          >
            ויזיטורים
          </button>
        </div>

        {manageMode !== 'none' && (
          <p
            className={`manage-hint ${
              manageMode === 'edit' ? 'mode-edit' : 'mode-delete'
            }`}
          >
            {sidebarRoster === 'workers'
              ? manageMode === 'edit'
                ? 'מצב עריכה: לחצו על עובד כדי לשנות את שמו'
                : 'מצב מחיקה: לחצו על עובד כדי למחוק אותו'
              : manageMode === 'edit'
                ? 'מצב עריכה: לחצו על שם כדי לשנות אותו'
                : 'מצב מחיקה: לחצו על שם כדי למחוק אותו'}
          </p>
        )}

        {sidebarRoster === 'workers' && (
        <div
          className={`roster-block workers-block ${
            manageMode === 'edit'
              ? 'mode-edit'
              : manageMode === 'delete'
                ? 'mode-delete'
                : ''
          }`}
        >
          <h3 className="roster-title">עובדים</h3>
          {sortedWorkers.length > 0 && (
            <div className="search-field workers-search-field">
              <IconSearch />
              <input
                type="search"
                className="workers-search"
                value={workerSearch}
                onChange={(e) => setWorkerSearch(e.target.value)}
                placeholder="חיפוש לפי שם…"
                aria-label="חיפוש עובדים לפי שם"
              />
            </div>
          )}
          {sortedWorkers.length === 0 ? (
            <div className="roster-scroll sidebar-workers-scroll roster-empty">
              אין עובדים ברשימה.
              <br />
              לחצו על «עובד חדש» כדי ליצור.
            </div>
          ) : filteredWorkers.length === 0 ? (
            <div className="roster-scroll sidebar-workers-scroll roster-empty">
              לא נמצאו עובדים לחיפוש.
            </div>
          ) : (
            <div className="workers-list-with-alpha">
              <div
                ref={workersScrollRef}
                className="roster-scroll sidebar-workers-scroll"
              >
                <div className="pick-grid workers">
                  {filteredWorkers.map((worker) => {
                    const present = isWorkerPresent(data, worker.id)
                    const managing = manageMode !== 'none'
                    const letter = workerAlphaLetter(worker)
                    return (
                      <div
                        key={worker.id}
                        className={`pick-wrap ${present && !managing ? 'is-present' : ''}`}
                        data-alpha-letter={letter}
                      >
                        <button
                          type="button"
                          className={`pick-btn worker ${present && !managing ? 'present' : ''} ${worker.temporary ? 'temporary' : ''} ${manageMode === 'edit' ? 'mode-edit' : ''} ${manageMode === 'delete' ? 'mode-delete' : ''}`}
                          onClick={() => void onWorkerCardClick(worker)}
                          disabled={!managing && present}
                          title={
                            manageMode === 'edit'
                              ? 'עריכת עובד'
                              : manageMode === 'delete'
                                ? 'מחיקת עובד'
                                : present
                                  ? 'כבר באתר'
                                  : 'הוסף לרשימה'
                          }
                        >
                          <span className="pick-label">{workerDisplayName(worker)}</span>
                          <span className="pick-hint">
                            {manageMode === 'edit'
                              ? 'עריכה'
                              : manageMode === 'delete'
                                ? 'מחיקה'
                                : present
                                  ? 'באתר'
                                  : worker.temporary
                                    ? 'זמני · עד חצות'
                                    : 'לחצו'}
                          </span>
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
              <nav
                className="workers-alpha-rail is-expanded"
                aria-label="ניווט אלפביתי לעובדים"
              >
                <div
                  className="workers-alpha-indicator"
                  aria-live="polite"
                  title={`מיקום נוכחי: ${activeWorkerLetter}`}
                >
                  {activeWorkerLetter === '#' ? '•' : activeWorkerLetter}
                </div>
                <div
                  ref={workersAlphaLettersRef}
                  className="workers-alpha-letters"
                >
                  {workerAlphaLetters.map((letter) => {
                    const available = workerLettersPresent.has(letter)
                    const active = activeWorkerLetter === letter
                    return (
                      <button
                        key={letter}
                        type="button"
                        className={`workers-alpha-letter ${active ? 'is-active' : ''} ${available ? 'is-available' : 'is-empty'}`}
                        disabled={!available}
                        onClick={() => scrollWorkersToLetter(letter)}
                        aria-label={`עבור ל־${letter}`}
                        aria-current={active ? 'true' : undefined}
                      >
                        {letter}
                      </button>
                    )
                  })}
                </div>
              </nav>
            </div>
          )}
        </div>
        )}

        {sidebarRoster === 'visitors' && data && (
        <div
          className={`roster-block visitors-block ${
            manageMode === 'edit'
              ? 'mode-edit'
              : manageMode === 'delete'
                ? 'mode-delete'
                : ''
          } ${selectedCardlessId ? 'is-affiliating' : ''}`}
        >
          <div className="roster-title-row">
            <h3 className="roster-title">ויזיטורים 1–30</h3>
            <button
              type="button"
              className="btn btn-ghost btn-visitor-manage"
              onClick={() => {
                clearManageMode()
                clearCardlessSelection()
                setVisitorManageMode('closed')
                setShowVisitorManage(true)
              }}
            >
              ניהול
            </button>
          </div>
          <div className="roster-scroll visitors-scroll sidebar-visitors-scroll">
            <div className="pick-grid visitors">
              {Array.from({ length: VISITOR_COUNT }, (_, i) => i + 1).map((n) => {
                const present = isVisitorPresent(data, n)
                const open = isVisitorNumberOpen(data, n)
                const slot = getVisitorSlot(data, n)
                const modeClass =
                  open && slot.access === 'open_constant'
                    ? 'visitor-open'
                    : open && slot.access === 'open_temp'
                      ? 'visitor-open-temp'
                      : ''
                const affiliating = selectedCardlessId != null
                const selectableForAffiliate =
                  affiliating && open && !present
                const dimmedVisitor =
                  affiliating && !selectableForAffiliate
                const selectedPerson = affiliating
                  ? data.cardlessPeople.find((c) => c.id === selectedCardlessId)
                  : null
                return (
                  <button
                    key={n}
                    type="button"
                    className={`pick-btn visitor ${present ? 'present' : ''} ${modeClass} ${
                      selectableForAffiliate ? 'is-selectable' : ''
                    } ${dimmedVisitor ? 'is-dimmed' : ''}`}
                    onClick={() => {
                      clearManageMode()
                      if (affiliating) {
                        if (!selectedPerson) {
                          clearCardlessSelection()
                          return
                        }
                        if (!open || present) {
                          setToast({
                            message: present
                              ? `ויזיטור ${n} כבר באתר`
                              : `ויזיטור ${n} סגור — בחרו ויזיטור פתוח`,
                          })
                          return
                        }
                        void affiliateCardlessToVisitor(selectedPerson, n)
                        return
                      }
                      // Sans nom sélectionné : pas d'affiliation depuis la grille
                      // (entrée anonyme uniquement)
                      void addVisitorToSite(n)
                    }}
                    disabled={present || dimmedVisitor}
                    title={
                      affiliating
                        ? selectableForAffiliate
                          ? `שייך ל־${selectedPerson ? cardlessDisplayName(selectedPerson) : 'השם שנבחר'}`
                          : present
                            ? 'כבר באתר'
                            : 'לא ניתן לבחור — בחרו ויזיטור פתוח פנוי'
                        : present
                          ? 'כבר באתר'
                          : open && slot.access === 'open_temp'
                            ? `ויזיטור ${n} · פתוח עד חצות`
                            : open
                              ? `הוסף ויזיטור ${n}`
                              : `ויזיטור ${n} · אין הרשאה`
                    }
                  >
                    <span className="pick-label">{n}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="cardless-section">
            <h3 className="roster-title">שמות לשיוך ויזיטור</h3>
            {data.cardlessPeople.length > 0 ? (
              <p className="cardless-empty">
                {selectedCardlessId
                  ? 'בחרו עכשיו ויזיטור פתוח מהרשת למעלה'
                  : 'בחרו שם, ואז ויזיטור פתוח מהרשת'}
              </p>
            ) : null}
            {data.cardlessPeople.length === 0 ? (
              <div className="roster-scroll cardless-scroll">
                <p className="cardless-empty">
                  אין שמות. לחצו על «+ שם חדש», בחרו את השם ואז ויזיטור פתוח מהרשת.
                </p>
              </div>
            ) : (
              <div className="workers-list-with-alpha cardless-list-with-alpha">
                <div
                  ref={cardlessScrollRef}
                  className="roster-scroll cardless-scroll"
                >
                  <div className="pick-grid workers cardless-pick-grid">
                    {sortedCardlessPeople.map((person) => {
                      const managing = manageMode !== 'none'
                      const present = isCardlessBlocked(data, person)
                      const isSelected = selectedCardlessId === person.id
                      const isDimmed =
                        !managing && selectedCardlessId != null && !isSelected
                      const letter = cardlessAlphaLetter(person)
                      return (
                        <div
                          key={person.id}
                          className={`pick-wrap ${present && !managing ? 'is-present' : ''} ${
                            isSelected ? 'is-selected' : ''
                          } ${isDimmed ? 'is-dimmed' : ''}`}
                          data-alpha-letter={letter}
                        >
                          <button
                            type="button"
                            className={`pick-btn worker ${present && !managing ? 'present' : ''} ${
                              person.temporary ? 'temporary' : ''
                            } ${manageMode === 'edit' ? 'mode-edit' : ''} ${
                              manageMode === 'delete' ? 'mode-delete' : ''
                            } ${isSelected ? 'is-selected' : ''}`}
                            onClick={() => void onCardlessNameClick(person)}
                            disabled={(!managing && present) || isDimmed}
                            title={
                              manageMode === 'edit'
                                ? 'עריכת שם'
                                : manageMode === 'delete'
                                  ? 'מחיקת שם'
                                  : present
                                    ? 'כבר באתר'
                                    : isSelected
                                      ? 'בטל בחירה'
                                      : 'בחרו שם ואז ויזיטור מהרשת'
                            }
                          >
                            <span className="pick-label">
                              {cardlessDisplayName(person)}
                              <span
                                className={`cardless-assign-hint ${
                                  person.assignment === 'multiple' ? 'multiple' : ''
                                }`}
                              >
                                {person.assignment === 'unique' ? 'יחיד' : 'מרובה'}
                              </span>
                            </span>
                            <span className="pick-hint">
                              {manageMode === 'edit'
                                ? 'עריכה'
                                : manageMode === 'delete'
                                  ? 'מחיקה'
                                  : present
                                    ? 'באתר'
                                    : isSelected
                                      ? 'נבחר'
                                      : person.temporary
                                        ? 'זמני · עד חצות'
                                        : 'לחצו'}
                            </span>
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
                {cardlessAlphaLetters.length > 0 ? (
                  <nav
                    className="workers-alpha-rail is-compact"
                    aria-label="ניווט אלפביתי לשמות ויזיטור"
                  >
                    <div
                      className="workers-alpha-indicator"
                      aria-live="polite"
                      title={`מיקום נוכחי: ${activeCardlessLetter}`}
                    >
                      {activeCardlessLetter === '#'
                        ? '•'
                        : activeCardlessLetter}
                    </div>
                    <div
                      ref={cardlessAlphaLettersRef}
                      className="workers-alpha-letters"
                    >
                      {cardlessAlphaLetters.map((letter) => {
                        const active = activeCardlessLetter === letter
                        return (
                          <button
                            key={letter}
                            type="button"
                            className={`workers-alpha-letter is-available ${
                              active ? 'is-active' : ''
                            }`}
                            onClick={() => scrollCardlessToLetter(letter)}
                            aria-label={`עבור ל־${letter}`}
                            aria-current={active ? 'true' : undefined}
                          >
                            {letter}
                          </button>
                        )
                      })}
                    </div>
                  </nav>
                ) : null}
              </div>
            )}
          </div>
        </div>
        )}
      </aside>

      <button
        type="button"
        className="sidebar-toggle"
        onClick={() => setSidebarCollapsed((v) => !v)}
        title={sidebarCollapsed ? 'הצג עובדים וויזיטורים' : 'הסתר עובדים וויזיטורים'}
        aria-label={sidebarCollapsed ? 'הצג עובדים וויזיטורים' : 'הסתר עובדים וויזיטורים'}
        aria-expanded={!sidebarCollapsed}
      >
        <svg
          viewBox="0 0 20 20"
          width="18"
          height="18"
          aria-hidden="true"
          className="sidebar-toggle-icon"
        >
          <path
            d="M7.5 4.5 L12.5 10 L7.5 15.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <main className="main-panel">
        <header className="main-header">
          <div className="brand">
            <h1>באתר עכשיו</h1>
          </div>
        </header>

        <div ref={listRef} className="list-capture panel">
          {renderPresenceListBody(filteredPresentPeople, {
            showActions: true,
            showFilters: true,
            layout: listLayout,
            columnCount: listColumnCount,
            columnChoice: listColumnChoice,
            onColumnChoiceChange: setListColumnChoice,
          })}
        </div>

        <div className="whatsapp-bar">
          <div className="emergency-actions">
            <button
              type="button"
              className={`btn btn-emergency ${
                whatsappWarn ? 'btn-emergency-warn' : ''
              }`}
              disabled={busy}
              onClick={() => void sendEmergencyList()}
              title={whatsappWarn ?? 'שליחת רשימת נוכחים למספרי החירום'}
            >
              <IconAlert />
              <span>חירום</span>
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-emergency-phones"
              onClick={() => {
                resetPhoneForm()
                setShowEmergencyPhones(true)
              }}
              title="ניהול מספרים"
            >
              <IconPhone />
              <span>
                מספרים
                {(data.settings.emergencyPhones?.length ?? 0) > 0
                  ? ` (${data.settings.emergencyPhones.length})`
                  : ''}
              </span>
            </button>
            {whatsappWarn ? (
              <button
                type="button"
                className={`emergency-status emergency-status-button ${
                  !whatsappStatus.online
                    ? 'emergency-status-offline'
                    : 'emergency-status-whatsapp'
                }`}
                onClick={() => void openWhatsAppWebLogin()}
                title="פתיחת חלון התחברות WhatsApp Web"
              >
                {whatsappWarn}
              </button>
            ) : whatsappStatus.connected || whatsappStatus.whatsappAvailable ? (
              <button
                type="button"
                className="emergency-status emergency-status-ok emergency-status-button"
                onClick={() => void openWhatsAppWebLogin()}
                title="פתיחת WhatsApp Web"
              >
                {whatsappStatus.channel === 'desktop'
                  ? 'WhatsApp מחובר'
                  : 'WhatsApp Web מחובר'}
              </button>
            ) : null}
          </div>
          {toast && <div className="toast">{toast.message}</div>}
          <button
            type="button"
            className="btn btn-preview"
            onClick={() => setShowListPreview(true)}
          >
            <svg
              className="btn-preview-icon"
              viewBox="0 0 24 24"
              width="18"
              height="18"
              aria-hidden="true"
            >
              <path
                d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <circle
                cx="12"
                cy="12"
                r="2.6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              />
            </svg>
            <span>תצוגה מקדימה</span>
          </button>
        </div>
      </main>
        </>
      )}

      {activeTab === 'banned' && (
        <main className="main-panel banned-panel">
          <header className="main-header">
            <div className="brand">
              <h1>רשימת אסורים</h1>
              <p>אנשים שאסור להכניס לאתר</p>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: 'auto' }}
              onClick={() => {
                resetBannedForm()
                setShowBannedModal(true)
              }}
            >
              + הוספת אדם אסור
            </button>
          </header>

          <div className="panel banned-list-panel">
            {sortedBanned.length === 0 ? (
              <div className="banned-empty">
                אין אנשים ברשימת האסורים.
                <br />
                לחצו על «הוספת אדם אסור» כדי להוסיף.
              </div>
            ) : (
              <div className="banned-list">
                {sortedBanned.map((person, index) => (
                  <article key={person.id} className="banned-row">
                    <div className="banned-main">
                      <div className="banned-name">
                        <span className="person-index">{index + 1}.</span>
                        {bannedDisplayName(person)}
                      </div>
                      {person.reason ? (
                        <div className="banned-reason">{person.reason}</div>
                      ) : (
                        <div className="banned-reason muted">ללא סיבה</div>
                      )}
                      {(person.plateNumber || person.idNumber) && (
                        <div className="banned-details">
                          {person.plateNumber && (
                            <span>לוחית רישוי: {person.plateNumber}</span>
                          )}
                          {person.idNumber && (
                            <span>תעודת זהות: {person.idNumber}</span>
                          )}
                        </div>
                      )}
                      <div className="banned-meta">
                        נוסף {formatDateTime(person.addedAt)}
                      </div>
                    </div>
                    <div className="banned-actions">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setEditingBanned({ ...person })}
                      >
                        עריכה
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() => void removeBannedPerson(person)}
                      >
                        הסרה
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
            {toast && <div className="toast">{toast.message}</div>}
          </div>
        </main>
      )}

      {activeTab === 'cameras' && (
        <main className="main-panel report-panel">
          <header className="main-header">
            <div className="brand">
              <h1>דוח מצלמות</h1>
              <p>מעקב ודיווח על מצלמות האתר</p>
            </div>
          </header>
          <div className="panel report-placeholder">
            <p>המסך הזה ייבנה בקרוב.</p>
          </div>
        </main>
      )}

      {activeTab === 'shift' && (
        <main className="main-panel report-panel">
          <header className="main-header">
            <div className="brand">
              <h1>דוח משמרת</h1>
              <p>דו״ח משמרת מאבטח מרלוג צרעה</p>
            </div>
          </header>
          <div className="panel shift-report-panel">
            <ShiftReportPanel
              value={data?.shiftReport}
              onChange={onShiftReportChange}
              texts={data?.shiftReportTexts}
              onTextsChange={onShiftReportTextsChange}
              onToast={(message) => setToast({ message })}
              settings={data?.settings}
              onSettingsChange={onShiftReportSettingsChange}
              archive={data?.shiftReportsArchive}
              onShiftContextChange={onShiftContextChange}
              getOperationalDayDate={getOperationalDayDate}
            />
          </div>
        </main>
      )}
      </div>

      {showListPreview && (
        <div
          className="modal-backdrop modal-backdrop-preview"
          onClick={() => setShowListPreview(false)}
        >
          <div
            className="preview-share-wrap"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="preview-layout-bar">
              <span className="preview-layout-label">תצוגת מסמך</span>
              <div className="preview-layout-controls">
                <div className="search-field list-search-field preview-search-field">
                  <IconSearch />
                  <input
                    type="search"
                    className="list-search preview-list-search"
                    value={listSearch}
                    onChange={(e) => setListSearch(e.target.value)}
                    placeholder="חיפוש לפי שם…"
                    aria-label="חיפוש לפי שם"
                  />
                </div>
                <FancySelect
                  className="list-sort-picker"
                  triggerClassName="list-sort-trigger"
                  ariaLabel="מיון הרשימה"
                  value={listSort}
                  options={[
                    { value: 'time_asc', label: 'שעה · מוקדם תחילה' },
                    { value: 'time_desc', label: 'שעה · מאוחר תחילה' },
                    { value: 'name', label: 'סדר אלפביתי' },
                  ]}
                  onChange={(v) => setListSort(v as ListSort)}
                />
                <FancySelect
                  className="list-kind-picker"
                  triggerClassName="list-kind-trigger"
                  ariaLabel="סינון לפי סוג"
                  value={listKindFilter}
                  options={[
                    { value: 'all', label: 'הכל' },
                    { value: 'visitors', label: 'ויזיטורים' },
                    { value: 'workers_constant', label: 'עובדים קבועים' },
                    { value: 'workers_temporary', label: 'עובדים זמניים' },
                  ]}
                  onChange={(v) => setListKindFilter(v as ListKindFilter)}
                />
                <div className="list-layout-controls">
                  <div
                    className="list-layout-toggle"
                    role="group"
                    aria-label="תצוגת תצוגה מקדימה"
                  >
                    <button
                      type="button"
                      className={`layout-icon-btn ${previewLayout === 'rows' ? 'active' : ''}`}
                      onClick={() => setPreviewLayout('rows')}
                      title="רשימה גלילה"
                      aria-label="רשימה גלילה"
                    >
                      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                        <rect x="2" y="3" width="16" height="3" rx="1" fill="currentColor" />
                        <rect x="2" y="8.5" width="16" height="3" rx="1" fill="currentColor" />
                        <rect x="2" y="14" width="16" height="3" rx="1" fill="currentColor" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={`layout-icon-btn ${previewLayout === 'columns' ? 'active' : ''}`}
                      onClick={() => setPreviewLayout('columns')}
                      title="תצוגה בעמודות"
                      aria-label="תצוגה בעמודות"
                    >
                      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                        <rect x="2" y="2" width="7" height="16" rx="1.5" fill="currentColor" />
                        <rect x="11" y="2" width="7" height="16" rx="1.5" fill="currentColor" />
                      </svg>
                    </button>
                  </div>
                  <div
                    className={`column-count-slot ${previewLayout === 'columns' ? 'is-visible' : 'is-hidden'}`}
                    aria-hidden={previewLayout !== 'columns'}
                  >
                    <ColumnCountPicker
                      choice={previewColumnChoice}
                      onChange={setPreviewColumnChoice}
                    />
                  </div>
                </div>
              </div>
            </div>
            <div
              className={`preview-pdf-shell ${
                previewLayout === 'rows' ? 'is-scroll' : 'is-columns'
              }`}
            >
              {renderPdfDocument()}
            </div>
            <div className="preview-actions">
              <button
                type="button"
                className="btn btn-primary btn-preview-close"
                onClick={() => setShowListPreview(false)}
              >
                סגירה
              </button>
              <button
                type="button"
                className="btn btn-primary btn-whatsapp"
                disabled={busy}
                onClick={() => openShareTargetPicker()}
              >
                שיתוף הרשימה ב־WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}

      {showShareTarget && data && (
        <div
          className="modal-backdrop"
          onClick={() => setShowShareTarget(false)}
        >
          <div
            className="modal modal-share-target"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>שליחת הרשימה ב־WhatsApp</h3>
            <p className="settings-note" style={{ marginBottom: 12 }}>
              בחרו מספר — התמונה תישלח ישירות לצ׳אט (בלי בחירה בתוך WhatsApp).
            </p>

            {(data.settings.emergencyPhones?.length ?? 0) > 0 ? (
              <div className="emergency-phone-scroll">
                <ul className="emergency-phone-list share-target-list">
                  {data.settings.emergencyPhones.map((contact) => (
                    <li key={contact.id}>
                      <div className="contact-phone-meta">
                        <strong>{contactDisplayName(contact)}</strong>
                        <span dir="ltr">{contact.phone}</span>
                        {contact.emergency ? (
                          <span className="contact-phone-badge emergency">חירום</span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ width: 'auto' }}
                        disabled={busy}
                        onClick={() =>
                          void shareListOnWhatsAppToPhone(contact.phone)
                        }
                      >
                        שלח
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="settings-note" style={{ marginBottom: 10 }}>
                אין מספרים שמורים — הזינו מספר למטה.
              </p>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault()
                void shareListOnWhatsAppToPhone(sharePhoneDraft)
              }}
            >
              <div className="field">
                <label htmlFor="sharePhone">מספר אחר</label>
                <input
                  id="sharePhone"
                  type="tel"
                  inputMode="tel"
                  value={sharePhoneDraft}
                  onChange={(e) => setSharePhoneDraft(e.target.value)}
                  placeholder="0501234567"
                  autoComplete="tel"
                  dir="ltr"
                />
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setShowShareTarget(false)}
                >
                  ביטול
                </button>
                <button
                  type="submit"
                  className="btn btn-primary btn-whatsapp"
                  style={{ width: 'auto' }}
                  disabled={busy || !normalizeWhatsAppPhone(sharePhoneDraft)}
                >
                  שלח תמונה
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEmergencyPhones && (
        <div
          className="modal-backdrop"
          onClick={() => setShowEmergencyPhones(false)}
        >
          <div
            className="modal modal-emergency-phones"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>מספרים</h3>
            <p className="settings-note" style={{ marginBottom: 12 }}>
              מספרי WhatsApp לשיתוף הרשימה. סמנו «חירום» רק למספרים שיקבלו
              הודעה בלחיצה על חירום.
            </p>

            {(data.settings.emergencyPhones?.length ?? 0) === 0 ? (
              <p className="settings-note">אין מספרים עדיין.</p>
            ) : (
              <div className="emergency-phone-scroll">
                <ul className="emergency-phone-list">
                  {data.settings.emergencyPhones.map((contact) => (
                    <li key={contact.id}>
                      <div className="contact-phone-meta">
                        <strong>{contactDisplayName(contact)}</strong>
                        <span dir="ltr">{contact.phone}</span>
                        {contact.emergency ? (
                          <span className="contact-phone-badge emergency">חירום</span>
                        ) : (
                          <span className="contact-phone-badge">שיתוף</span>
                        )}
                      </div>
                      <div className="contact-phone-actions">
                        <button
                          type="button"
                          className={`btn btn-ghost ${
                            contact.emergency ? 'mode-active' : ''
                          }`}
                          onClick={() => void toggleContactEmergency(contact.id)}
                          title={
                            contact.emergency
                              ? 'הסר מסימון חירום'
                              : 'סמן כמספר חירום'
                          }
                        >
                          {contact.emergency ? 'חירום ✓' : 'חירום'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => void removeEmergencyPhone(contact.id)}
                        >
                          הסרה
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <form onSubmit={(e) => void addEmergencyPhone(e)}>
              <div className="row-2">
                <div className="field">
                  <label htmlFor="contactName">שם</label>
                  <input
                    id="contactName"
                    value={emergencyNameDraft}
                    onChange={(e) => setEmergencyNameDraft(e.target.value)}
                    placeholder="מנהל / שמירה…"
                    autoFocus
                    autoComplete="off"
                  />
                </div>
                <div className="field">
                  <label htmlFor="emergencyPhone">מספר טלפון</label>
                  <input
                    id="emergencyPhone"
                    type="tel"
                    inputMode="tel"
                    value={emergencyPhoneDraft}
                    onChange={(e) => setEmergencyPhoneDraft(e.target.value)}
                    placeholder="0501234567"
                    autoComplete="tel"
                    dir="ltr"
                  />
                </div>
              </div>
              <div className="field">
                <label>סוג מספר</label>
                <div className="type-toggle">
                  <button
                    type="button"
                    className={`type-toggle-btn ${emergencyFlagDraft ? 'active' : ''}`}
                    onClick={() => setEmergencyFlagDraft(true)}
                  >
                    חירום
                  </button>
                  <button
                    type="button"
                    className={`type-toggle-btn ${!emergencyFlagDraft ? 'active' : ''}`}
                    onClick={() => setEmergencyFlagDraft(false)}
                  >
                    שיתוף בלבד
                  </button>
                </div>
                <p className="settings-note" style={{ marginTop: 6 }}>
                  {emergencyFlagDraft
                    ? 'יכלל בשליחת חירום ובשיתוף התצוגה המקדימה'
                    : 'רק לשיתוף התצוגה המקדימה — לא יישלח בלחיצת חירום'}
                </p>
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setShowEmergencyPhones(false)}
                >
                  סגירה
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ width: 'auto' }}
                >
                  הוספה
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showNewWorker && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setShowNewWorker(false)
            resetNewWorkerForm()
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>עובד חדש</h3>
            <form onSubmit={createNewWorker}>
              <div className="row-2">
                <div className="field">
                  <label htmlFor="newFirst">שם פרטי</label>
                  <input
                    id="newFirst"
                    value={newWorker.firstName}
                    onChange={(e) =>
                      setNewWorker((s) => ({ ...s, firstName: e.target.value }))
                    }
                    placeholder="יוסי"
                    autoFocus
                    autoComplete="off"
                  />
                </div>
                <div className="field">
                  <label htmlFor="newLast">שם משפחה (אופציונלי)</label>
                  <input
                    id="newLast"
                    value={newWorker.lastName}
                    onChange={(e) =>
                      setNewWorker((s) => ({ ...s, lastName: e.target.value }))
                    }
                    placeholder="כהן"
                    autoComplete="off"
                  />
                </div>
              </div>
              <div className="field">
                <label>סוג עובד</label>
                <div className="type-toggle">
                  <button
                    type="button"
                    className={`type-toggle-btn ${!newWorkerTemporary ? 'active' : ''}`}
                    onClick={() => setNewWorkerTemporary(false)}
                  >
                    קבוע
                  </button>
                  <button
                    type="button"
                    className={`type-toggle-btn ${newWorkerTemporary ? 'active' : ''}`}
                    onClick={() => setNewWorkerTemporary(true)}
                  >
                    זמני
                  </button>
                </div>
                <p className="settings-note" style={{ marginTop: 6 }}>
                  {newWorkerTemporary
                    ? 'הכרטיס יימחק בחצות היום'
                    : 'הכרטיס נשאר ברשימה הקבועה'}
                </p>
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setShowNewWorker(false)
                    resetNewWorkerForm()
                  }}
                >
                  ביטול
                </button>
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }}>
                  יצירה והוספה
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showNewCardless && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setShowNewCardless(false)
            resetNewCardlessForm()
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>שם לשיוך ויזיטור</h3>
            <form onSubmit={createNewCardless}>
              <div className="row-2">
                <div className="field">
                  <label htmlFor="newCardlessFirst">שם פרטי</label>
                  <input
                    id="newCardlessFirst"
                    value={newCardless.firstName}
                    onChange={(e) =>
                      setNewCardless((s) => ({
                        ...s,
                        firstName: e.target.value,
                      }))
                    }
                    placeholder="יוסי"
                    autoFocus
                    autoComplete="off"
                  />
                </div>
                <div className="field">
                  <label htmlFor="newCardlessLast">שם משפחה (אופציונלי)</label>
                  <input
                    id="newCardlessLast"
                    value={newCardless.lastName}
                    onChange={(e) =>
                      setNewCardless((s) => ({
                        ...s,
                        lastName: e.target.value,
                      }))
                    }
                    placeholder="כהן"
                    autoComplete="off"
                  />
                </div>
              </div>
              <div className="field">
                <label>סוג שיוך</label>
                <div className="type-toggle">
                  <button
                    type="button"
                    className={`type-toggle-btn ${newCardlessAssignment === 'unique' ? 'active' : ''}`}
                    onClick={() => setNewCardlessAssignment('unique')}
                  >
                    עובד יחיד
                  </button>
                  <button
                    type="button"
                    className={`type-toggle-btn ${newCardlessAssignment === 'multiple' ? 'active' : ''}`}
                    onClick={() => setNewCardlessAssignment('multiple')}
                  >
                    עובד מרובה
                  </button>
                </div>
                <p className="settings-note" style={{ marginTop: 6 }}>
                  {newCardlessAssignment === 'unique'
                    ? 'לאחר כניסה לאתר השם ייחסם עד ליציאה'
                    : 'ניתן לשייך את אותו שם לכמה ויזיטורים'}
                </p>
              </div>
              <div className="field">
                <label>תוקף השם</label>
                <div className="type-toggle">
                  <button
                    type="button"
                    className={`type-toggle-btn ${!newCardlessTemporary ? 'active' : ''}`}
                    onClick={() => setNewCardlessTemporary(false)}
                  >
                    קבוע
                  </button>
                  <button
                    type="button"
                    className={`type-toggle-btn ${newCardlessTemporary ? 'active' : ''}`}
                    onClick={() => setNewCardlessTemporary(true)}
                  >
                    עד חצות
                  </button>
                </div>
                <p className="settings-note" style={{ marginTop: 6 }}>
                  {newCardlessTemporary
                    ? 'השם יימחק מרשימת השיוך בחצות'
                    : 'השם נשאר ברשימת השיוך'}
                </p>
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setShowNewCardless(false)
                    resetNewCardlessForm()
                  }}
                >
                  ביטול
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ width: 'auto' }}
                >
                  הוספת שם
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingCardless && (
        <div
          className="modal-backdrop"
          onClick={() => setEditingCardless(null)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>עריכת שם</h3>
            <form onSubmit={saveEditedCardless}>
              <div className="row-2">
                <div className="field">
                  <label htmlFor="editCardlessFirst">שם פרטי</label>
                  <input
                    id="editCardlessFirst"
                    value={editingCardless.firstName}
                    onChange={(e) =>
                      setEditingCardless({
                        ...editingCardless,
                        firstName: e.target.value,
                      })
                    }
                    autoFocus
                    autoComplete="off"
                  />
                </div>
                <div className="field">
                  <label htmlFor="editCardlessLast">שם משפחה (אופציונלי)</label>
                  <input
                    id="editCardlessLast"
                    value={editingCardless.lastName}
                    onChange={(e) =>
                      setEditingCardless({
                        ...editingCardless,
                        lastName: e.target.value,
                      })
                    }
                    autoComplete="off"
                  />
                </div>
              </div>
              <div className="field">
                <label>סוג שיוך</label>
                <div className="type-toggle">
                  <button
                    type="button"
                    className={`type-toggle-btn ${
                      editingCardless.assignment === 'unique' ? 'active' : ''
                    }`}
                    onClick={() =>
                      setEditingCardless({
                        ...editingCardless,
                        assignment: 'unique',
                      })
                    }
                  >
                    עובד יחיד
                  </button>
                  <button
                    type="button"
                    className={`type-toggle-btn ${
                      editingCardless.assignment === 'multiple' ? 'active' : ''
                    }`}
                    onClick={() =>
                      setEditingCardless({
                        ...editingCardless,
                        assignment: 'multiple',
                      })
                    }
                  >
                    עובד מרובה
                  </button>
                </div>
                <p className="settings-note" style={{ marginTop: 6 }}>
                  {editingCardless.assignment === 'unique'
                    ? 'לאחר כניסה לאתר השם ייחסם עד ליציאה'
                    : 'ניתן לשייך את אותו שם לכמה ויזיטורים'}
                </p>
              </div>
              <div className="field">
                <label>תוקף השם</label>
                <div className="type-toggle">
                  <button
                    type="button"
                    className={`type-toggle-btn ${!editingCardless.temporary ? 'active' : ''}`}
                    onClick={() =>
                      setEditingCardless({
                        ...editingCardless,
                        temporary: false,
                        expiresAt: null,
                      })
                    }
                  >
                    קבוע
                  </button>
                  <button
                    type="button"
                    className={`type-toggle-btn ${editingCardless.temporary ? 'active' : ''}`}
                    onClick={() =>
                      setEditingCardless({
                        ...editingCardless,
                        temporary: true,
                        expiresAt: endOfTodayMidnight(),
                      })
                    }
                  >
                    עד חצות
                  </button>
                </div>
                <p className="settings-note" style={{ marginTop: 6 }}>
                  {editingCardless.temporary
                    ? 'השם יימחק מרשימת השיוך בחצות'
                    : 'השם נשאר ברשימת השיוך'}
                </p>
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setEditingCardless(null)}
                >
                  ביטול
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ width: 'auto' }}
                >
                  שמירה
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingWorker && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setEditingWorker(null)
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>עריכת עובד</h3>
            <form onSubmit={saveEditedWorker}>
              <div className="row-2">
                <div className="field">
                  <label htmlFor="editWorkerFirst">שם פרטי</label>
                  <input
                    id="editWorkerFirst"
                    value={editingWorker.firstName}
                    onChange={(e) =>
                      setEditingWorker({
                        ...editingWorker,
                        firstName: e.target.value,
                      })
                    }
                    autoFocus
                    autoComplete="off"
                  />
                </div>
                <div className="field">
                  <label htmlFor="editWorkerLast">שם משפחה (אופציונלי)</label>
                  <input
                    id="editWorkerLast"
                    value={editingWorker.lastName}
                    onChange={(e) =>
                      setEditingWorker({
                        ...editingWorker,
                        lastName: e.target.value,
                      })
                    }
                    autoComplete="off"
                  />
                </div>
              </div>
              <div className="field">
                <label>סוג עובד</label>
                <div className="type-toggle">
                  <button
                    type="button"
                    className={`type-toggle-btn ${!editingWorker.temporary ? 'active' : ''}`}
                    onClick={() =>
                      setEditingWorker({
                        ...editingWorker,
                        temporary: false,
                        expiresAt: null,
                      })
                    }
                  >
                    קבוע
                  </button>
                  <button
                    type="button"
                    className={`type-toggle-btn ${editingWorker.temporary ? 'active' : ''}`}
                    onClick={() =>
                      setEditingWorker({
                        ...editingWorker,
                        temporary: true,
                        expiresAt: endOfTodayMidnight(),
                      })
                    }
                  >
                    זמני
                  </button>
                </div>
                <p className="settings-note" style={{ marginTop: 6 }}>
                  {editingWorker.temporary
                    ? 'הכרטיס יימחק בחצות היום'
                    : 'הכרטיס נשאר ברשימה הקבועה'}
                </p>
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setEditingWorker(null)
                  }}
                >
                  ביטול
                </button>
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }}>
                  שמירה
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showVisitorManage && data && (
        <div
          className="modal-backdrop"
          onClick={() => setShowVisitorManage(false)}
        >
          <div
            className="modal modal-visitor-manage"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>ניהול ויזיטורים</h3>
            <p className="settings-note" style={{ marginBottom: 10 }}>
              בחרו מצב, ואז לחצו על המספרים להחלה. כברירת מחדל כולם סגורים.
            </p>

            <div className="visitor-manage-modes">
              <button
                type="button"
                className={`visitor-mode-chip closed ${visitorManageMode === 'closed' ? 'active' : ''}`}
                onClick={() => setVisitorManageMode('closed')}
              >
                סגור
              </button>
              <button
                type="button"
                className={`visitor-mode-chip open-temp ${visitorManageMode === 'open_temp' ? 'active' : ''}`}
                onClick={() => setVisitorManageMode('open_temp')}
              >
                פתוח זמני
              </button>
              <button
                type="button"
                className={`visitor-mode-chip open-constant ${visitorManageMode === 'open_constant' ? 'active' : ''}`}
                onClick={() => setVisitorManageMode('open_constant')}
              >
                פתוח קבוע
              </button>
            </div>

            <div className="visitor-manage-bulk">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void applyVisitorModeToAll(visitorManageMode)}
              >
                החל על כולם
              </button>
            </div>

            <div className="pick-grid visitors visitor-manage-grid">
              {Array.from({ length: VISITOR_COUNT }, (_, i) => i + 1).map((n) => {
                const slot = getVisitorSlot(data, n)
                const open = isVisitorNumberOpen(data, n)
                const modeClass =
                  open && slot.access === 'open_constant'
                    ? 'visitor-open'
                    : open && slot.access === 'open_temp'
                      ? 'visitor-open-temp'
                      : 'visitor-manage-closed'
                return (
                  <button
                    key={n}
                    type="button"
                    className={`pick-btn visitor ${modeClass}`}
                    onClick={() => void setVisitorSlotAccess(n, visitorManageMode)}
                    title={
                      slot.access === 'open_constant'
                        ? 'פתוח קבוע'
                        : slot.access === 'open_temp' && open
                          ? 'פתוח זמני עד חצות'
                          : 'סגור'
                    }
                  >
                    <span className="pick-label">{n}</span>
                  </button>
                )
              })}
            </div>

            <div className="visitor-manage-legend">
              <span className="legend closed">סגור</span>
              <span className="legend temp">זמני עד חצות</span>
              <span className="legend constant">קבוע</span>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: 'auto' }}
                onClick={() => setShowVisitorManage(false)}
              >
                סיום
              </button>
            </div>
          </div>
        </div>
      )}

      {showBannedModal && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setShowBannedModal(false)
            resetBannedForm()
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>הוספת אדם אסור</h3>
            <form onSubmit={createBannedPerson}>
              <div className="row-2">
                <div className="field">
                  <label htmlFor="bannedFirst">שם פרטי</label>
                  <input
                    id="bannedFirst"
                    value={newBanned.firstName}
                    onChange={(e) =>
                      setNewBanned((s) => ({ ...s, firstName: e.target.value }))
                    }
                    placeholder="יוסי"
                    autoFocus
                    autoComplete="off"
                  />
                </div>
                <div className="field">
                  <label htmlFor="bannedLast">שם משפחה</label>
                  <input
                    id="bannedLast"
                    value={newBanned.lastName}
                    onChange={(e) =>
                      setNewBanned((s) => ({ ...s, lastName: e.target.value }))
                    }
                    placeholder="כהן"
                    autoComplete="off"
                  />
                </div>
              </div>
              <div className="row-2">
                <div className="field">
                  <label htmlFor="bannedPlate">לוחית רישוי (אופציונלי)</label>
                  <input
                    id="bannedPlate"
                    value={newBanned.plateNumber}
                    onChange={(e) =>
                      setNewBanned((s) => ({
                        ...s,
                        plateNumber: e.target.value,
                      }))
                    }
                    placeholder="12-345-67"
                    autoComplete="off"
                  />
                </div>
                <div className="field">
                  <label htmlFor="bannedId">תעודת זהות (אופציונלי)</label>
                  <input
                    id="bannedId"
                    value={newBanned.idNumber}
                    onChange={(e) =>
                      setNewBanned((s) => ({
                        ...s,
                        idNumber: e.target.value,
                      }))
                    }
                    placeholder="000000000"
                    autoComplete="off"
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="bannedReason">סיבה (אופציונלי)</label>
                <textarea
                  id="bannedReason"
                  rows={3}
                  value={newBanned.reason}
                  onChange={(e) =>
                    setNewBanned((s) => ({ ...s, reason: e.target.value }))
                  }
                  placeholder="למה אסור להכניס לאתר"
                />
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setShowBannedModal(false)
                    resetBannedForm()
                  }}
                >
                  ביטול
                </button>
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }}>
                  הוספה לרשימה
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingBanned && (
        <div
          className="modal-backdrop"
          onClick={() => setEditingBanned(null)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>עריכת אדם אסור</h3>
            <form onSubmit={saveEditedBanned}>
              <div className="row-2">
                <div className="field">
                  <label htmlFor="editBannedFirst">שם פרטי</label>
                  <input
                    id="editBannedFirst"
                    value={editingBanned.firstName}
                    onChange={(e) =>
                      setEditingBanned({
                        ...editingBanned,
                        firstName: e.target.value,
                      })
                    }
                    autoFocus
                    autoComplete="off"
                  />
                </div>
                <div className="field">
                  <label htmlFor="editBannedLast">שם משפחה</label>
                  <input
                    id="editBannedLast"
                    value={editingBanned.lastName}
                    onChange={(e) =>
                      setEditingBanned({
                        ...editingBanned,
                        lastName: e.target.value,
                      })
                    }
                    autoComplete="off"
                  />
                </div>
              </div>
              <div className="row-2">
                <div className="field">
                  <label htmlFor="editBannedPlate">לוחית רישוי (אופציונלי)</label>
                  <input
                    id="editBannedPlate"
                    value={editingBanned.plateNumber}
                    onChange={(e) =>
                      setEditingBanned({
                        ...editingBanned,
                        plateNumber: e.target.value,
                      })
                    }
                    placeholder="12-345-67"
                    autoComplete="off"
                  />
                </div>
                <div className="field">
                  <label htmlFor="editBannedId">תעודת זהות (אופציונלי)</label>
                  <input
                    id="editBannedId"
                    value={editingBanned.idNumber}
                    onChange={(e) =>
                      setEditingBanned({
                        ...editingBanned,
                        idNumber: e.target.value,
                      })
                    }
                    placeholder="000000000"
                    autoComplete="off"
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="editBannedReason">סיבה (אופציונלי)</label>
                <textarea
                  id="editBannedReason"
                  rows={3}
                  value={editingBanned.reason}
                  onChange={(e) =>
                    setEditingBanned({
                      ...editingBanned,
                      reason: e.target.value,
                    })
                  }
                />
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setEditingBanned(null)}
                >
                  ביטול
                </button>
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }}>
                  שמירה
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {updateState && (
        <div className="update-overlay" role="dialog" aria-modal="true">
          <div className="update-card">
            {updateState.phase === 'available' && (
              <>
                <h3>עדכון זמין</h3>
                <p>
                  גרסה חדשה מוכנה להתקנה: <strong>v{updateState.version}</strong>
                </p>
                <p className="update-note">
                  הנתונים שלך נשמרים. האפליקציה תיסגר ותיפתח מחדש אחרי העדכון.
                </p>
                <div className="update-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setUpdateState(null)}
                  >
                    אחר כך
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void startUpdateDownload()}
                  >
                    עדכן עכשיו
                  </button>
                </div>
              </>
            )}

            {updateState.phase === 'downloading' && (
              <>
                <h3>מוריד עדכון…</h3>
                <p>
                  גרסה <strong>v{updateState.version}</strong>
                </p>
                <div className="update-progress-track" aria-hidden="true">
                  <div
                    className="update-progress-bar"
                    style={{ width: `${updateState.percent}%` }}
                  />
                </div>
                <p className="update-percent">{Math.round(updateState.percent)}%</p>
                <div className="update-spinner" aria-hidden="true" />
              </>
            )}

            {updateState.phase === 'installing' && (
              <>
                <h3>מתקין ומפעיל מחדש…</h3>
                <p>
                  גרסה <strong>v{updateState.version}</strong>
                </p>
                <div className="update-spinner" aria-hidden="true" />
                <p className="update-note">אנא המתן, הנתונים נשמרים.</p>
              </>
            )}

            {updateState.phase === 'error' && (
              <>
                <h3>שגיאה בעדכון</h3>
                <p>{updateState.message}</p>
                <div className="update-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setUpdateState(null)}
                  >
                    סגירה
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div ref={shareRef} className="list-capture-share" aria-hidden="true">
        {renderPdfDocument()}
      </div>
    </div>
  )
}
