import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  SHIFT_LABELS,
  SHIFT_NOTE_YELLOW_HIGHLIGHT,
  applyEquipmentTemplatesToReport,
  createDefaultShiftReportTexts,
  createEmptyShiftReport,
  normalizeShiftReport,
  normalizeShiftReportTexts,
  type DeptEquipmentRow,
  type ShiftDeptTemplateItem,
  type ShiftKind,
  type ShiftReport,
  type ShiftReportTexts,
  type ShiftStationTemplateItem,
  type StationEquipmentRow,
} from './shiftReport'
import {
  blobToUint8Array,
  buildShiftReportDocx,
  shiftReportFileName,
} from './shiftReportDocx'
import { SHIFT_REPORT_DOCUMENT_TITLE } from './shiftReportDocument'
import ShiftRichListEditor from './ShiftRichListEditor'
import GuardNameField from './GuardNameField'
import GuardNamesManager from './GuardNamesManager'
import ShiftReportDateField from './ShiftReportDateField'
import EmailAlreadySentModal from './EmailAlreadySentModal'
import EmailSendLogModal from './EmailSendLogModal'
import {
  flushShiftReportAutoSave,
  scheduleShiftReportAutoSave,
} from './shiftReportAutoSave'
import type { AppSettings, ShiftEmailSentLogItem } from './types'
import { buildShiftReportDocumentModel } from './shiftReportDocument'
import type { ShiftReportsArchive } from './shiftReportArchive'
import { getShiftDayStatus, getShiftFromArchive } from './shiftReportArchive'
import { getNextDayReportContext, shiftDateToDate } from './shiftReportPaths'

const SHOW_WORD_EXPORT = false

type Props = {
  value: ShiftReport | null | undefined
  onChange: (next: ShiftReport) => void
  texts?: ShiftReportTexts | null
  onTextsChange?: (next: ShiftReportTexts) => void
  onToast?: (message: string) => void
  settings?: AppSettings
  onSettingsChange?: (partial: Partial<AppSettings>) => void
  archive?: ShiftReportsArchive
  onShiftContextChange?: (
    date: string,
    shift: ShiftKind,
    currentReport?: ShiftReport,
  ) => void
  getOperationalDayDate?: (now?: Date, shift?: ShiftKind) => string
}

type EditSection = 'reminders' | 'faults' | 'general' | 'dept' | 'station' | null

type SectionDraft = {
  reminders: string[]
  openFaultsFixed: string[]
  generalNotesHtml: string[]
  deptTemplate: ShiftDeptTemplateItem[]
  stationTemplate: ShiftStationTemplateItem[]
}

function textsToSectionDraft(texts: ShiftReportTexts): SectionDraft {
  return {
    reminders: [...texts.reminders],
    openFaultsFixed: [...texts.openFaultsFixed],
    generalNotesHtml: [...texts.generalNotesHtml],
    deptTemplate: texts.deptTemplate.map((item) => ({ ...item })),
    stationTemplate: texts.stationTemplate.map((item) => ({ ...item })),
  }
}

function isOtherSectionEditing(
  editSection: EditSection,
  section: Exclude<EditSection, null>,
): boolean {
  return editSection != null && editSection !== section
}

function RichLinesView({
  lines,
  className,
}: {
  lines: string[]
  className?: string
}) {
  return (
    <ul className={className}>
      {lines.map((line, index) => (
        <li
          key={`${index}-${line.slice(0, 40)}`}
          dangerouslySetInnerHTML={{ __html: line }}
        />
      ))}
    </ul>
  )
}

function ShiftDayStatusRow({
  date,
  archive,
  current,
  onSelectShift,
}: {
  date: string
  archive?: ShiftReportsArchive
  current: ShiftReport
  onSelectShift: (shift: ShiftKind) => void
}) {
  const items = getShiftDayStatus(archive, date, current)
  const filledCount = items.filter((i) => i.filled).length

  return (
    <div className="shift-day-status" aria-label="סטטוס משמרות היום">
      <div className="shift-day-status-head">
        <span className="shift-day-status-title">משמרות היום</span>
        <span className="shift-day-status-count">
          {filledCount}/3 מולאו
        </span>
      </div>
      <div className="shift-day-status-pills">
        {items.map((item) => (
          <button
            key={item.shift}
            type="button"
            className={`shift-status-pill${item.filled ? ' is-filled' : ''}${
              item.isActive ? ' is-active' : ''
            }`}
            title={
              item.filled
                ? `${SHIFT_LABELS[item.shift]} — ${item.guardName}`
                : `${SHIFT_LABELS[item.shift]} — טרם מולא`
            }
            onClick={() => onSelectShift(item.shift)}
          >
            <span className="shift-status-icon" aria-hidden>
              {item.filled ? '✓' : '○'}
            </span>
            <span className="shift-status-label">{SHIFT_LABELS[item.shift]}</span>
            {item.filled ? (
              <span className="shift-status-guard">{item.guardName}</span>
            ) : (
              <span className="shift-status-guard is-empty">ריק</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function ShiftReportPanel({
  value,
  onChange,
  texts: textsProp,
  onTextsChange,
  onToast,
  settings,
  onSettingsChange,
  archive,
  onShiftContextChange,
  getOperationalDayDate,
}: Props) {
  const [report, setReport] = useState<ShiftReport>(() =>
    normalizeShiftReport(value),
  )
  const [showSettings, setShowSettings] = useState(false)
  const [texts, setTexts] = useState(() => normalizeShiftReportTexts(textsProp))
  const [exporting, setExporting] = useState(false)
  const [testingEmail, setTestingEmail] = useState(false)
  const [sendingEmail, setSendingEmail] = useState(false)
  const [alreadySentInfo, setAlreadySentInfo] = useState<{
    sentAt?: string
    messageId?: string
    to?: string
  } | null>(null)
  const [showEmailLog, setShowEmailLog] = useState(false)
  const [emailLogEntries, setEmailLogEntries] = useState<ShiftEmailSentLogItem[]>(
    [],
  )
  const [loadingEmailLog, setLoadingEmailLog] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [editSection, setEditSection] = useState<EditSection>(null)
  const [draft, setDraft] = useState<SectionDraft>(() =>
    textsToSectionDraft(normalizeShiftReportTexts(textsProp)),
  )
  const [editorKey, setEditorKey] = useState(0)
  const saveTimer = useRef<number | null>(null)
  const suppressDebounceRef = useRef(false)
  const onChangeRef = useRef(onChange)
  const reportRef = useRef(report)
  onChangeRef.current = onChange
  reportRef.current = report

  function clearPendingReportSave() {
    if (saveTimer.current != null) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
  }

  function flushPendingReportSave() {
    clearPendingReportSave()
    onChangeRef.current(reportRef.current)
  }

  const outputTexts = useMemo(() => {
    if (!editSection) return texts
    if (editSection === 'reminders') {
      return normalizeShiftReportTexts({ ...texts, reminders: draft.reminders })
    }
    if (editSection === 'faults') {
      return normalizeShiftReportTexts({
        ...texts,
        openFaultsFixed: draft.openFaultsFixed,
      })
    }
    if (editSection === 'general') {
      return normalizeShiftReportTexts({
        ...texts,
        generalNotesHtml: draft.generalNotesHtml,
      })
    }
    if (editSection === 'dept') {
      return normalizeShiftReportTexts({
        ...texts,
        deptTemplate: draft.deptTemplate,
      })
    }
    if (editSection === 'station') {
      return normalizeShiftReportTexts({
        ...texts,
        stationTemplate: draft.stationTemplate,
      })
    }
    return texts
  }, [editSection, draft, texts])

  const outputTextsRef = useRef(outputTexts)
  outputTextsRef.current = outputTexts

  useEffect(() => {
    if (!settings) return
    scheduleShiftReportAutoSave(settings, report, outputTexts)
  }, [report, outputTexts, settings])

  useEffect(() => {
    return () => {
      if (settings?.shiftReportSaveFolder?.trim()) {
        void flushShiftReportAutoSave(
          settings,
          reportRef.current,
          outputTextsRef.current,
        )
      }
    }
  }, [settings])

  useEffect(() => {
    setTexts(normalizeShiftReportTexts(textsProp))
  }, [textsProp])

  useEffect(() => {
    suppressDebounceRef.current = true
    setReport(normalizeShiftReport(value, normalizeShiftReportTexts(textsProp)))
  }, [value])

  useEffect(() => {
    if (suppressDebounceRef.current) {
      suppressDebounceRef.current = false
      return
    }
    clearPendingReportSave()
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null
      const current = reportRef.current
      onChangeRef.current(current)
    }, 200)
    return clearPendingReportSave
  }, [report])

  useEffect(() => {
    return () => {
      flushPendingReportSave()
    }
  }, [])

  function patch(partial: Partial<ShiftReport>) {
    setReport((prev) => ({ ...prev, ...partial }))
  }

  function patchDept(id: string, partial: Partial<DeptEquipmentRow>) {
    setReport((prev) => ({
      ...prev,
      deptEquipment: prev.deptEquipment.map((row) =>
        row.id === id ? { ...row, ...partial } : row,
      ),
    }))
  }

  function patchStation(id: string, partial: Partial<StationEquipmentRow>) {
    setReport((prev) => ({
      ...prev,
      stationEquipment: prev.stationEquipment.map((row) =>
        row.id === id ? { ...row, ...partial } : row,
      ),
    }))
  }

  function updateGuardNames(guardNames: string[]) {
    const nextTexts = normalizeShiftReportTexts({ ...texts, guardNames })
    setTexts(nextTexts)
    onTextsChange?.(nextTexts)
  }

  function resetTemplate() {
    const ok = window.confirm(
      'לאפס את הדוח לתבנית חדשה ולעבור ליום הבא (אותה משמרת)?',
    )
    if (!ok) return
    flushPendingReportSave()
    onChangeRef.current(reportRef.current)
    if (settings?.shiftReportSaveFolder?.trim()) {
      void flushShiftReportAutoSave(
        settings,
        reportRef.current,
        outputTextsRef.current,
      )
    }
    const { shift } = reportRef.current
    const { date } = getNextDayReportContext(
      reportRef.current.date,
      reportRef.current.shift,
    )
    const next = {
      ...createEmptyShiftReport(shiftDateToDate(date), texts),
      shift,
      date,
    }
    suppressDebounceRef.current = true
    setReport(next)
    onChangeRef.current(next)
  }

  function switchShiftContext(date: string, shift: ShiftKind) {
    if (shift === reportRef.current.shift && date === reportRef.current.date.trim()) {
      return
    }
    flushPendingReportSave()
    if (settings?.shiftReportSaveFolder?.trim()) {
      void flushShiftReportAutoSave(
        settings,
        reportRef.current,
        outputTextsRef.current,
      )
    }
    const currentReport = reportRef.current
    const nextReport = getShiftFromArchive(archive, date, shift, texts)
    suppressDebounceRef.current = true
    setReport(nextReport)
    onShiftContextChange?.(date, shift, currentReport)
  }

  function handleDateChange(date: string) {
    if (date.trim() === report.date.trim()) return
    if (onShiftContextChange) {
      switchShiftContext(date, report.shift)
      return
    }
    patch({ date })
  }

  function handleShiftChange(shift: ShiftKind) {
    let date = report.date
    if (getOperationalDayDate && shift === 'night' && new Date().getHours() < 6) {
      date = getOperationalDayDate(new Date(), shift)
    }
    if (onShiftContextChange) {
      switchShiftContext(date, shift)
      return
    }
    patch({ shift, date })
  }

  async function testEmailSettings() {
    if (testingEmail) return
    const directorEmail = settings?.directorEmail?.trim()
    const smtpHost = settings?.shiftReportSmtpHost?.trim()
    const smtpUser = settings?.shiftReportSmtpUser?.trim()
    const smtpPass = settings?.shiftReportSmtpPass ?? ''
    const smtpPort = settings?.shiftReportSmtpPort ?? 587
    if (!directorEmail || !smtpHost || !smtpUser || !smtpPass) {
      onToast?.('יש למלא אימייל מנהל, שרת SMTP, משתמש וסיסמה')
      return
    }
    if (!window.listeApi?.sendShiftReportTestEmail) {
      onToast?.('בדיקת דוא״ל אינה זמינה')
      return
    }
    setTestingEmail(true)
    try {
      const result = await window.listeApi.sendShiftReportTestEmail({
        directorEmail,
        smtpHost,
        smtpPort,
        smtpUser,
        smtpPass,
      })
      if (result.ok) {
        onToast?.('הודעת בדיקה נשלחה בהצלחה')
        return
      }
      onToast?.(`שליחת בדיקה נכשלה: ${result.error ?? 'שגיאה'}`)
    } catch {
      onToast?.('שליחת בדיקה נכשלה')
    } finally {
      setTestingEmail(false)
    }
  }

  function emailSendErrorMessage(error?: string): string {
    switch (error) {
      case 'missing_config':
        return 'יש למלא אימייל מנהל, SMTP, סיסמה ותיקיית שמירה'
      case 'no_report_data':
        return 'אין נתוני דוח ליום זה'
      case 'no_attachments':
        return 'לא נמצאו קבצי Word — שמרו את הדוחות קודם'
      default:
        return error ?? 'שגיאה'
    }
  }

  async function sendReportEmail(options?: { force?: boolean }) {
    if (sendingEmail) return
    const directorEmail = settings?.directorEmail?.trim()
    const smtpHost = settings?.shiftReportSmtpHost?.trim()
    const smtpUser = settings?.shiftReportSmtpUser?.trim()
    const smtpPass = settings?.shiftReportSmtpPass ?? ''
    if (!directorEmail || !smtpHost || !smtpUser || !smtpPass) {
      onToast?.('יש למלא אימייל מנהל, שרת SMTP, משתמש וסיסמה')
      return
    }
    if (!settings?.shiftReportSaveFolder?.trim()) {
      onToast?.('יש לבחור תיקיית שמירה')
      return
    }
    if (!window.listeApi?.sendShiftReportEmail) {
      onToast?.('שליחת דוא״ל אינה זמינה')
      return
    }
    setSendingEmail(true)
    try {
      const result = await window.listeApi.sendShiftReportEmail({
        date: report.date,
        force: options?.force,
      })
      if (result.alreadySent && !options?.force) {
        setAlreadySentInfo({
          sentAt: result.sentAt,
          messageId: result.messageId,
          to: result.to ?? directorEmail,
        })
        return
      }
      if (result.ok) {
        setAlreadySentInfo(null)
        onToast?.('דוא״ל נשלח בהצלחה')
        return
      }
      onToast?.(`שליחה נכשלה: ${emailSendErrorMessage(result.error)}`)
    } catch {
      onToast?.('שליחה נכשלה')
    } finally {
      setSendingEmail(false)
    }
  }

  async function openEmailSendLog() {
    if (!window.listeApi?.getShiftReportEmailSentLog) {
      onToast?.('יומן השליחות אינו זמין')
      return
    }
    setShowEmailLog(true)
    setLoadingEmailLog(true)
    try {
      const entries = await window.listeApi.getShiftReportEmailSentLog()
      setEmailLogEntries(entries)
    } catch {
      onToast?.('טעינת יומן השליחות נכשלה')
      setShowEmailLog(false)
    } finally {
      setLoadingEmailLog(false)
    }
  }

  async function pickSaveFolder() {
    if (!window.listeApi?.pickFolder) return
    const result = await window.listeApi.pickFolder()
    if (!result.ok || result.canceled || !result.path) return
    onSettingsChange?.({ shiftReportSaveFolder: result.path })
    onToast?.('תיקיית שמירה עודכנה')
  }

  function openEdit(section: Exclude<EditSection, null>) {
    setDraft(textsToSectionDraft(texts))
    setEditorKey((k) => k + 1)
    setEditSection(section)
  }

  function closeEdit() {
    setEditSection(null)
  }

  function saveReminders() {
    const nextTexts = normalizeShiftReportTexts({
      ...texts,
      reminders: draft.reminders,
    })
    setTexts(nextTexts)
    onTextsChange?.(nextTexts)
    onToast?.('התזכורות עודכנו')
    setEditSection(null)
  }

  function saveFaults() {
    const nextTexts = normalizeShiftReportTexts({
      ...texts,
      openFaultsFixed: draft.openFaultsFixed,
    })
    setTexts(nextTexts)
    onTextsChange?.(nextTexts)
    onToast?.('תקלות פתוחות עודכנו')
    setEditSection(null)
  }

  function saveGeneral() {
    const nextTexts = normalizeShiftReportTexts({
      ...texts,
      generalNotesHtml: draft.generalNotesHtml,
    })
    setTexts(nextTexts)
    onTextsChange?.(nextTexts)
    onToast?.('הערות כלליות עודכנו')
    setEditSection(null)
  }

  function saveDept() {
    const nextTexts = normalizeShiftReportTexts({
      ...texts,
      deptTemplate: draft.deptTemplate,
    })
    setTexts(nextTexts)
    onTextsChange?.(nextTexts)
    const nextReport = applyEquipmentTemplatesToReport(report, nextTexts)
    setReport(nextReport)
    onChangeRef.current(nextReport)
    onToast?.('תבנית ציוד מחלקתי עודכנה')
    setEditSection(null)
  }

  function saveStation() {
    const nextTexts = normalizeShiftReportTexts({
      ...texts,
      stationTemplate: draft.stationTemplate,
    })
    setTexts(nextTexts)
    onTextsChange?.(nextTexts)
    const nextReport = applyEquipmentTemplatesToReport(report, nextTexts)
    setReport(nextReport)
    onChangeRef.current(nextReport)
    onToast?.('תבנית עמדת מאבטח עודכנה')
    setEditSection(null)
  }

  function saveCurrentSection() {
    switch (editSection) {
      case 'reminders':
        saveReminders()
        break
      case 'faults':
        saveFaults()
        break
      case 'general':
        saveGeneral()
        break
      case 'dept':
        saveDept()
        break
      case 'station':
        saveStation()
        break
    }
  }

  function resetSectionDraft() {
    const defaults = createDefaultShiftReportTexts()
    setEditorKey((k) => k + 1)
    switch (editSection) {
      case 'reminders':
        setDraft((prev) => ({
          ...prev,
          reminders: [...defaults.reminders],
        }))
        break
      case 'faults':
        setDraft((prev) => ({
          ...prev,
          openFaultsFixed: [...defaults.openFaultsFixed],
        }))
        break
      case 'general':
        setDraft((prev) => ({
          ...prev,
          generalNotesHtml: [...defaults.generalNotesHtml],
        }))
        break
      case 'dept':
        setDraft((prev) => ({
          ...prev,
          deptTemplate: defaults.deptTemplate.map((item) => ({ ...item })),
        }))
        break
      case 'station':
        setDraft((prev) => ({
          ...prev,
          stationTemplate: defaults.stationTemplate.map((item) => ({ ...item })),
        }))
        break
    }
  }

  function patchDeptTemplateDraft(
    index: number,
    partial: Partial<ShiftDeptTemplateItem>,
  ) {
    setDraft((prev) => ({
      ...prev,
      deptTemplate: prev.deptTemplate.map((item, i) =>
        i === index ? { ...item, ...partial } : item,
      ),
    }))
  }

  function addDeptTemplateRow() {
    setDraft((prev) => ({
      ...prev,
      deptTemplate: [
        ...prev.deptTemplate,
        { id: `dept-${Date.now()}`, name: '', notes: '' },
      ],
    }))
  }

  function removeDeptTemplateRow(index: number) {
    setDraft((prev) => ({
      ...prev,
      deptTemplate: prev.deptTemplate.filter((_, i) => i !== index),
    }))
  }

  function patchStationTemplateDraft(
    index: number,
    partial: Partial<ShiftStationTemplateItem>,
  ) {
    setDraft((prev) => ({
      ...prev,
      stationTemplate: prev.stationTemplate.map((item, i) =>
        i === index ? { ...item, ...partial } : item,
      ),
    }))
  }

  function addStationTemplateRow() {
    setDraft((prev) => ({
      ...prev,
      stationTemplate: [
        ...prev.stationTemplate,
        { id: `station-${Date.now()}`, name: '', quantity: 1, notes: '' },
      ],
    }))
  }

  function removeStationTemplateRow(index: number) {
    setDraft((prev) => ({
      ...prev,
      stationTemplate: prev.stationTemplate.filter((_, i) => i !== index),
    }))
  }

  function textsForOutput(): ShiftReportTexts {
    return outputTexts
  }

  async function exportWord() {
    if (exporting) return
    setExporting(true)
    try {
      // Flush latest edits before export (rapport + textes en cours d’édition)
      onChangeRef.current(report)
      const exportTexts = textsForOutput()
      if (editSection) {
        setTexts(exportTexts)
        onTextsChange?.(exportTexts)
      }
      const blob = await buildShiftReportDocx(report, exportTexts)
      const fileName = shiftReportFileName(report)
      if (window.listeApi?.saveBytes) {
        const bytes = Array.from(await blobToUint8Array(blob))
        const result = await window.listeApi.saveBytes({
          defaultName: fileName,
          bytes,
          filters: [{ name: 'Word', extensions: ['docx'] }],
        })
        if (result.canceled) return
        if (result.ok) {
          onToast?.('קובץ Word נשמר')
          return
        }
        onToast?.('שמירת קובץ Word נכשלה')
        return
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)
      onToast?.('קובץ Word הורד')
    } catch {
      onToast?.('ייצוא Word נכשל')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="shift-report-page">
      <header className="main-header">
        <div className="brand">
          <h1>דוח משמרת</h1>
          <p>{SHIFT_REPORT_DOCUMENT_TITLE}</p>
        </div>
        <div className="main-header-actions">
          <button
            type="button"
            className="btn btn-success"
            style={{ width: 'auto' }}
            onClick={resetTemplate}
          >
            דוח חדש
          </button>
          <button
            type="button"
            className="btn btn-preview"
            style={{ marginInlineStart: 0 }}
            onClick={() => setShowPreview(true)}
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
          {SHOW_WORD_EXPORT ? (
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: 'auto' }}
              onClick={() => void exportWord()}
              disabled={exporting}
            >
              {exporting ? 'מייצא…' : 'ייצוא ל־Word'}
            </button>
          ) : null}
          <button
            type="button"
            className={`btn btn-ghost${showSettings ? ' active' : ''}`}
            style={{ width: 'auto' }}
            onClick={() => setShowSettings((v) => !v)}
          >
            הגדרות שמירה
          </button>
        </div>
      </header>

      <div className="panel shift-report-panel">
        <div className="shift-report" dir="rtl">
      {showSettings ? (
        <section className="shift-section shift-settings-card">
          <h3>שמירה אוטומטית ודוא״ל יומי</h3>
          <GuardNamesManager
            names={texts.guardNames}
            onChange={updateGuardNames}
          />
          <div className="shift-settings-grid">
            <label className="shift-field shift-settings-path">
              <span>תיקיית שמירה</span>
              <div className="shift-settings-path-row">
                <input
                  type="text"
                  value={settings?.shiftReportSaveFolder ?? ''}
                  placeholder="C:\Reports\shift-reports"
                  onChange={(e) =>
                    onSettingsChange?.({
                      shiftReportSaveFolder: e.target.value,
                    })
                  }
                />
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ width: 'auto' }}
                  onClick={() => void pickSaveFolder()}
                >
                  בחר…
                </button>
              </div>
            </label>
            <label className="shift-field">
              <span>אימייל מנהל</span>
              <input
                type="email"
                value={settings?.directorEmail ?? ''}
                placeholder="manager@example.com"
                onChange={(e) =>
                  onSettingsChange?.({ directorEmail: e.target.value })
                }
              />
            </label>
            <label className="shift-field">
              <span>שעת שליחה יומית</span>
              <input
                type="time"
                value={settings?.shiftReportEmailTime ?? '07:00'}
                onChange={(e) =>
                  onSettingsChange?.({ shiftReportEmailTime: e.target.value })
                }
              />
            </label>
            <label className="shift-field">
              <span>מצב שליחה</span>
              <select
                value={settings?.shiftReportEmailMode ?? 'auto'}
                onChange={(e) =>
                  onSettingsChange?.({
                    shiftReportEmailMode:
                      e.target.value === 'manual' ? 'manual' : 'auto',
                  })
                }
              >
                <option value="auto">אוטומטית (בשעה שנקבעה)</option>
                <option value="manual">ידנית בלבד</option>
              </select>
            </label>
            <label className="shift-field">
              <span>שרת SMTP</span>
              <input
                type="text"
                value={settings?.shiftReportSmtpHost ?? ''}
                placeholder="smtp.office365.com"
                onChange={(e) =>
                  onSettingsChange?.({ shiftReportSmtpHost: e.target.value })
                }
              />
            </label>
            <label className="shift-field">
              <span>פורט SMTP</span>
              <input
                type="number"
                value={settings?.shiftReportSmtpPort ?? 587}
                onChange={(e) =>
                  onSettingsChange?.({
                    shiftReportSmtpPort: Number(e.target.value) || 587,
                  })
                }
              />
            </label>
            <label className="shift-field">
              <span>משתמש SMTP</span>
              <input
                type="text"
                value={settings?.shiftReportSmtpUser ?? ''}
                onChange={(e) =>
                  onSettingsChange?.({ shiftReportSmtpUser: e.target.value })
                }
              />
            </label>
            <label className="shift-field">
              <span>סיסמת SMTP</span>
              <input
                type="password"
                value={settings?.shiftReportSmtpPass ?? ''}
                onChange={(e) =>
                  onSettingsChange?.({ shiftReportSmtpPass: e.target.value })
                }
              />
            </label>
          </div>
          <div className="shift-settings-test-row">
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: 'auto' }}
              onClick={() => void sendReportEmail()}
              disabled={sendingEmail}
            >
              {sendingEmail ? 'שולח…' : 'שלח דוחות במייל'}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: 'auto' }}
              onClick={() => void testEmailSettings()}
              disabled={testingEmail}
            >
              {testingEmail ? 'שולח בדיקה…' : 'בדיקת דוא״ל'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ width: 'auto' }}
              onClick={() => void openEmailSendLog()}
            >
              יומן שליחות
            </button>
            <span className="shift-settings-test-hint">
              שולח הודעת בדיקה לכתובת המנהל (Gmail: smtp.gmail.com, פורט 587)
            </span>
          </div>
        </section>
      ) : null}

      {/* Ordre comme le Word : titre → en-tête → règle → תזכורות → תקלות → הערות → ציוד → עמדה → הערות קבועות */}
      <section className="shift-section shift-title-block">
        <h2>{SHIFT_REPORT_DOCUMENT_TITLE}</h2>
      </section>

      <section className="shift-section shift-meta-card">
        <ShiftDayStatusRow
          date={report.date}
          archive={archive}
          current={report}
          onSelectShift={handleShiftChange}
        />
        <div className="shift-meta-grid">
          <ShiftReportDateField
            value={report.date}
            onCommit={handleDateChange}
            onInvalid={() => onToast?.('תאריך לא תקין')}
          />
          <GuardNameField
            label="שומר/ת נכנס"
            value={report.guardIn}
            names={texts.guardNames}
            onChange={(guardIn) => patch({ guardIn })}
          />
          <label className="shift-field">
            <span>משמרת</span>
            <select
              value={report.shift}
              onChange={(e) =>
                handleShiftChange(e.target.value as ShiftKind)
              }
            >
              {(Object.keys(SHIFT_LABELS) as ShiftKind[]).map((key) => (
                <option key={key} value={key}>
                  {SHIFT_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
          <GuardNameField
            label="שומר/ת יוצא"
            value={report.guardOut}
            names={texts.guardNames}
            onChange={(guardOut) => patch({ guardOut })}
          />
        </div>
        <p className="shift-journal-rule">
          {texts.journalRuleLead}
          <mark className="shift-preview-yellow">
            {texts.journalRuleHighlight}
          </mark>
        </p>
      </section>

      <section
        className={`shift-section shift-reminders-section${editSection === 'reminders' ? ' is-editing' : ''}`}
      >
        <div className="shift-section-head">
          <h3>תזכורות</h3>
          {editSection === 'reminders' ? (
            <div className="shift-section-edit-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={resetSectionDraft}
              >
                איפוס
              </button>
              <button type="button" className="btn btn-ghost" onClick={closeEdit}>
                ביטול
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: 'auto' }}
                onClick={saveCurrentSection}
              >
                שמירה
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-ghost shift-section-edit"
              onClick={() => openEdit('reminders')}
              disabled={isOtherSectionEditing(editSection, 'reminders')}
            >
              עריכה
            </button>
          )}
        </div>
        {editSection === 'reminders' ? (
          <ShiftRichListEditor
            key={`reminders-${editorKey}`}
            lines={draft.reminders}
            listClassName="shift-reminders"
            onChange={(reminders) =>
              setDraft((prev) => ({ ...prev, reminders }))
            }
          />
        ) : (
          <RichLinesView lines={texts.reminders} className="shift-reminders" />
        )}
      </section>

      <section
        className={`shift-section${editSection === 'faults' ? ' is-editing' : ''}`}
      >
        <div className="shift-section-head">
          <h3>תקלות פתוחות</h3>
          {editSection === 'faults' ? (
            <div className="shift-section-edit-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={resetSectionDraft}
              >
                איפוס
              </button>
              <button type="button" className="btn btn-ghost" onClick={closeEdit}>
                ביטול
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: 'auto' }}
                onClick={saveCurrentSection}
              >
                שמירה
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-ghost shift-section-edit"
              onClick={() => openEdit('faults')}
              disabled={isOtherSectionEditing(editSection, 'faults')}
            >
              עריכה
            </button>
          )}
        </div>
        {editSection === 'faults' ? (
          <>
            <ShiftRichListEditor
              key={`faults-${editorKey}`}
              lines={draft.openFaultsFixed}
              listClassName="shift-fixed-faults"
              onChange={(openFaultsFixed) =>
                setDraft((prev) => ({ ...prev, openFaultsFixed }))
              }
            />
            <textarea
              className="shift-textarea"
              rows={3}
              value={report.openIssues}
              onChange={(e) => patch({ openIssues: e.target.value })}
              placeholder="הוסיפו תקלות פתוחות נוספות…"
            />
          </>
        ) : (
          <>
            <RichLinesView
              lines={texts.openFaultsFixed}
              className="shift-fixed-faults"
            />
            {report.openIssues.trim() ? (
              <ul className="shift-fixed-faults shift-extra-lines">
                {report.openIssues
                  .split('\n')
                  .map((line) => line.trim())
                  .filter(Boolean)
                  .map((line) => (
                    <li key={line}>{line}</li>
                  ))}
              </ul>
            ) : null}
          </>
        )}
      </section>

      <section
        className={`shift-section${editSection === 'general' ? ' is-editing' : ''}`}
      >
        <div className="shift-section-head">
          <h3>הערות כלליות</h3>
          {editSection === 'general' ? (
            <div className="shift-section-edit-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={resetSectionDraft}
              >
                איפוס
              </button>
              <button type="button" className="btn btn-ghost" onClick={closeEdit}>
                ביטול
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: 'auto' }}
                onClick={saveCurrentSection}
              >
                שמירה
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-ghost shift-section-edit"
              onClick={() => openEdit('general')}
              disabled={isOtherSectionEditing(editSection, 'general')}
            >
              עריכה
            </button>
          )}
        </div>
        {editSection === 'general' ? (
          <ShiftRichListEditor
            key={`general-${editorKey}`}
            lines={draft.generalNotesHtml}
            listClassName="shift-fixed-general"
            onChange={(generalNotesHtml) =>
              setDraft((prev) => ({ ...prev, generalNotesHtml }))
            }
          />
        ) : (
          <RichLinesView
            lines={texts.generalNotesHtml}
            className="shift-fixed-general"
          />
        )}
      </section>

      <section
        className={`shift-section${editSection === 'dept' ? ' is-editing' : ''}`}
      >
        <div className="shift-section-head">
          <h3>בדיקת ציוד מחלקתי</h3>
          {editSection === 'dept' ? (
            <div className="shift-section-edit-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={resetSectionDraft}
              >
                איפוס
              </button>
              <button type="button" className="btn btn-ghost" onClick={closeEdit}>
                ביטול
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: 'auto' }}
                onClick={saveCurrentSection}
              >
                שמירה
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-ghost shift-section-edit"
              onClick={() => openEdit('dept')}
              disabled={isOtherSectionEditing(editSection, 'dept')}
            >
              עריכה
            </button>
          )}
        </div>
        {editSection === 'dept' ? (
          <div className="field">
            <div className="shift-texts-notes-list">
              {draft.deptTemplate.map((item, index) => (
                <div
                  key={item.id}
                  className="shift-texts-equip-row shift-texts-dept-row"
                >
                  <input
                    type="text"
                    value={item.name}
                    placeholder="שם פריט"
                    onChange={(e) =>
                      patchDeptTemplateDraft(index, { name: e.target.value })
                    }
                  />
                  <input
                    type="text"
                    value={item.notes}
                    placeholder="הערות ברירת מחדל"
                    onChange={(e) =>
                      patchDeptTemplateDraft(index, { notes: e.target.value })
                    }
                  />
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => removeDeptTemplateRow(index)}
                  >
                    הסר
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-ghost shift-texts-add-row"
              onClick={addDeptTemplateRow}
            >
              הוסף שורה
            </button>
          </div>
        ) : (
          <div className="shift-table-wrap">
            <table className="shift-table">
              <thead>
                <tr>
                  <th className="col-num">מס׳</th>
                  <th className="col-name">סוג פריט/ציוד</th>
                  <th className="col-status">תקין</th>
                  <th className="col-status">לא תקין</th>
                  <th className="col-notes">הערות</th>
                </tr>
              </thead>
              <tbody>
                {report.deptEquipment.map((row, index) => (
                  <tr key={row.id}>
                    <td className="col-num">{index + 1}</td>
                    <td className="col-name">{row.name}</td>
                    <td className="col-status">
                      <button
                        type="button"
                        className={`shift-check ${row.status === 'ok' ? 'active ok' : ''}`}
                        onClick={() =>
                          patchDept(row.id, {
                            status: row.status === 'ok' ? '' : 'ok',
                          })
                        }
                        aria-label={`${row.name} תקין`}
                      >
                        {row.status === 'ok' ? 'V' : ''}
                      </button>
                    </td>
                    <td className="col-status">
                      <button
                        type="button"
                        className={`shift-check ${row.status === 'bad' ? 'active bad' : ''}`}
                        onClick={() =>
                          patchDept(row.id, {
                            status: row.status === 'bad' ? '' : 'bad',
                          })
                        }
                        aria-label={`${row.name} לא תקין`}
                      >
                        {row.status === 'bad' ? 'X' : ''}
                      </button>
                    </td>
                    <td className="col-notes">
                      <input
                        type="text"
                        value={row.notes}
                        onChange={(e) =>
                          patchDept(row.id, { notes: e.target.value })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section
        className={`shift-section${editSection === 'station' ? ' is-editing' : ''}`}
      >
        <div className="shift-section-head">
          <h3>עמדת מאבטח</h3>
          {editSection === 'station' ? (
            <div className="shift-section-edit-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={resetSectionDraft}
              >
                איפוס
              </button>
              <button type="button" className="btn btn-ghost" onClick={closeEdit}>
                ביטול
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: 'auto' }}
                onClick={saveCurrentSection}
              >
                שמירה
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-ghost shift-section-edit"
              onClick={() => openEdit('station')}
              disabled={isOtherSectionEditing(editSection, 'station')}
            >
              עריכה
            </button>
          )}
        </div>
        {editSection === 'station' ? (
          <div className="field">
            <div className="shift-texts-notes-list">
              {draft.stationTemplate.map((item, index) => (
                <div
                  key={item.id}
                  className="shift-texts-equip-row shift-texts-station-row"
                >
                  <input
                    type="text"
                    value={item.name}
                    placeholder="שם פריט"
                    onChange={(e) =>
                      patchStationTemplateDraft(index, {
                        name: e.target.value,
                      })
                    }
                  />
                  <input
                    type="number"
                    min={0}
                    value={item.quantity}
                    placeholder="כמות"
                    onChange={(e) =>
                      patchStationTemplateDraft(index, {
                        quantity: Number(e.target.value) || 0,
                      })
                    }
                  />
                  <input
                    type="text"
                    value={item.notes}
                    placeholder="הערות ברירת מחדל"
                    onChange={(e) =>
                      patchStationTemplateDraft(index, {
                        notes: e.target.value,
                      })
                    }
                  />
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => removeStationTemplateRow(index)}
                  >
                    הסר
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-ghost shift-texts-add-row"
              onClick={addStationTemplateRow}
            >
              הוסף שורה
            </button>
          </div>
        ) : (
          <div className="shift-table-wrap">
            <table className="shift-table">
              <thead>
                <tr>
                  <th className="col-num">מס׳</th>
                  <th className="col-name">סוג פריט/ציוד</th>
                  <th className="col-qty">כמות</th>
                  <th className="col-status">בפועל</th>
                  <th className="col-notes">הערות</th>
                </tr>
              </thead>
              <tbody>
                {report.stationEquipment.map((row, index) => (
                  <tr key={row.id}>
                    <td className="col-num">{index + 1}.</td>
                    <td className="col-name">{row.name}</td>
                    <td className="col-qty">
                      <input
                        type="number"
                        min={0}
                        value={row.quantity}
                        onChange={(e) =>
                          patchStation(row.id, {
                            quantity: Number(e.target.value) || 0,
                          })
                        }
                      />
                    </td>
                    <td className="col-status">
                      <button
                        type="button"
                        className={`shift-check ${row.present ? 'active ok' : ''}`}
                        onClick={() =>
                          patchStation(row.id, { present: !row.present })
                        }
                        aria-label={`${row.name} בפועל`}
                      >
                        {row.present ? 'V' : ''}
                      </button>
                    </td>
                    <td className="col-notes">
                      <input
                        type="text"
                        value={row.notes}
                        onChange={(e) =>
                          patchStation(row.id, { notes: e.target.value })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
        </div>
      </div>

      {showPreview
        ? createPortal(
            <div
              className="modal-backdrop modal-backdrop-preview"
              onClick={() => setShowPreview(false)}
            >
              <div
                className="preview-share-wrap shift-preview-wrap"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="preview-layout-bar">
                  <span className="preview-layout-label">
                    תצוגה מקדימה · דוח משמרת
                  </span>
                  <div className="preview-layout-controls">
                    {SHOW_WORD_EXPORT ? (
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ width: 'auto' }}
                        onClick={() => void exportWord()}
                        disabled={exporting}
                      >
                        {exporting ? 'מייצא…' : 'ייצוא ל־Word'}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-preview btn-preview-close"
                      style={{ marginInlineStart: 0 }}
                      onClick={() => setShowPreview(false)}
                    >
                      סגור
                    </button>
                  </div>
                </div>
                <div className="shift-preview-shell">
                  <ShiftReportPreviewDocument
                    report={report}
                    texts={textsForOutput()}
                  />
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {showEmailLog
        ? createPortal(
            <EmailSendLogModal
              entries={emailLogEntries}
              loading={loadingEmailLog}
              onClose={() => setShowEmailLog(false)}
            />,
            document.body,
          )
        : null}

      {alreadySentInfo
        ? createPortal(
            <EmailAlreadySentModal
              sentAt={alreadySentInfo.sentAt}
              messageId={alreadySentInfo.messageId}
              to={alreadySentInfo.to}
              resending={sendingEmail}
              onClose={() => setAlreadySentInfo(null)}
              onResend={() => void sendReportEmail({ force: true })}
            />,
            document.body,
          )
        : null}
    </div>
  )
}

function ShiftReportPreviewDocument({
  report,
  texts,
}: {
  report: ShiftReport
  texts: ShiftReportTexts
}) {
  const model = buildShiftReportDocumentModel(report, texts)

  return (
    <article className="shift-preview-doc" dir="rtl">
      <h1 className="shift-preview-title">{model.title}</h1>

      <table className="shift-preview-meta">
        <tbody>
          <tr>
            <td className="cell-white">
              <strong>תאריך:</strong> {model.report.date || ' '}
            </td>
            <td className="cell-gray">
              <strong>שומר/ת נכנס:</strong> {model.report.guardIn || ' '}
            </td>
          </tr>
          <tr>
            <td className="cell-white">
              <strong>משמרת:</strong> {SHIFT_LABELS[model.report.shift]}
            </td>
            <td className="cell-blue">
              <strong>שומר/ת יוצא:</strong> {model.report.guardOut || ' '}
            </td>
          </tr>
        </tbody>
      </table>

      <p className="shift-preview-rule">
        {model.texts.journalRuleLead}
        <mark className="shift-preview-yellow">
          {model.texts.journalRuleHighlight}
        </mark>
      </p>

      <div className="shift-preview-red-box">
        <RichLinesView lines={model.texts.reminders} />
      </div>

      <h3 className="shift-preview-h">תקלות פתוחות:</h3>
      <div className="shift-preview-box">
        <ul className="shift-preview-faults">
          {model.texts.openFaultsFixed.map((line, index) => (
            <li
              key={`f-${index}`}
              dangerouslySetInnerHTML={{ __html: line }}
            />
          ))}
          {model.extraFaults.map((line) => (
            <li key={line} className="is-extra">
              {line}
            </li>
          ))}
        </ul>
      </div>

      <h3 className="shift-preview-h">הערות כלליות :</h3>
      <div className="shift-preview-box">
        <ul className="shift-preview-general">
          {model.texts.generalNotesHtml.map((line, index) => (
            <li
              key={`g-${index}`}
              dangerouslySetInnerHTML={{ __html: line }}
            />
          ))}
        </ul>
      </div>

      <h3 className="shift-preview-h">בדיקת ציוד מחלקתי</h3>
      <table className="shift-preview-table">
        <thead>
          <tr>
            <th>מס׳</th>
            <th>סוג פריט/ציוד</th>
            <th>תקין</th>
            <th>לא תקין</th>
            <th>הערות</th>
          </tr>
        </thead>
        <tbody>
          {model.report.deptEquipment.map((row, index) => (
            <tr key={row.id}>
              <td>{index + 1}</td>
              <td className="name">{row.name}</td>
              <td className="check">{row.status === 'ok' ? 'V' : ''}</td>
              <td className="check">{row.status === 'bad' ? 'X' : ''}</td>
              <td className="notes">{row.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="shift-preview-h">עמדת מאבטח</h3>
      <table className="shift-preview-table">
        <thead>
          <tr>
            <th>מס׳</th>
            <th>סוג פריט/ציוד</th>
            <th>כמות</th>
            <th>בפועל</th>
            <th>הערות</th>
          </tr>
        </thead>
        <tbody>
          {model.report.stationEquipment.map((row, index) => {
            const yellow =
              SHIFT_NOTE_YELLOW_HIGHLIGHT.length > 0 &&
              row.notes.includes(SHIFT_NOTE_YELLOW_HIGHLIGHT)
            return (
              <tr key={row.id}>
                <td>{index + 1}.</td>
                <td className="name">{row.name}</td>
                <td className="check">{row.quantity}</td>
                <td className="check">{row.present ? 'V' : ''}</td>
                <td className={`notes is-red ${yellow ? 'is-yellow' : ''}`}>
                  {row.notes}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </article>
  )
}
