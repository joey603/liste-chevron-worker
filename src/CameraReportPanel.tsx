import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
  getCameraDayStatus,
  type CameraReportsArchive,
} from './cameraReportArchive'
import {
  createEmptyCameraReport,
  createNextScanEntry,
  getShiftDefaultHours,
  formatScanRange,
  normalizeCameraReport,
  sortScansByTime,
  type CameraReport,
  type CameraScanEntry,
} from './cameraReport'
import {
  flushCameraReportAutoSave,
  scheduleCameraReportAutoSave,
} from './cameraReportAutoSave'
import { getCameraReportSaveFolder } from './cameraReportPaths'
import CameraReportExcelPreview from './CameraReportExcelPreview'
import GuardNameField from './GuardNameField'
import EmailAlreadySentModal from './EmailAlreadySentModal'
import { SHIFT_LABELS, type ShiftKind } from './shiftReport'
import { getNextShiftContext } from './shiftReportArchive'
import { parseShiftReportDate } from './shiftReportPaths'
import { createId } from './types'
import type { AppSettings } from './types'

type Props = {
  value?: CameraReport | null
  onChange: (next: CameraReport) => void
  onToast?: (message: string) => void
  settings?: AppSettings
  onSettingsChange?: (partial: Partial<AppSettings>) => void
  archive?: CameraReportsArchive
  onShiftContextChange?: (
    date: string,
    shift: ShiftKind,
    currentReport?: CameraReport,
  ) => void
  guardNameSuggestions?: string[]
}

function CameraDayStatusRow({
  date,
  archive,
  current,
  onSelectShift,
}: {
  date: string
  archive?: CameraReportsArchive
  current: CameraReport
  onSelectShift: (shift: ShiftKind) => void
}) {
  const items = getCameraDayStatus(archive, date, current)
  const filledCount = items.filter((i) => i.filled).length

  return (
    <div className="shift-day-status" aria-label="סטטוס סריקות מצלמות היום">
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
                ? `${SHIFT_LABELS[item.shift]} — ${item.guardName} (${item.scanCount} סריקות)`
                : `${SHIFT_LABELS[item.shift]} — טרם מולא`
            }
            onClick={() => onSelectShift(item.shift)}
          >
            <span className="shift-status-icon" aria-hidden>
              {item.filled ? '✓' : '○'}
            </span>
            <span className="shift-status-label">{SHIFT_LABELS[item.shift]}</span>
            {item.filled ? (
              <span className="shift-status-guard">
                {item.guardName}
                {item.scanCount > 0 ? ` · ${item.scanCount}` : ''}
              </span>
            ) : (
              <span className="shift-status-guard is-empty">ריק</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function CameraReportPanel({
  value,
  onChange,
  onToast,
  settings,
  onSettingsChange,
  archive,
  onShiftContextChange,
  guardNameSuggestions = [],
}: Props) {
  const [report, setReport] = useState<CameraReport>(() =>
    normalizeCameraReport(value),
  )
  const [showSettings, setShowSettings] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [testingEmail, setTestingEmail] = useState(false)
  const [sendingEmail, setSendingEmail] = useState(false)
  const [alreadySentInfo, setAlreadySentInfo] = useState<{
    sentAt?: string
    messageId?: string
    to?: string
  } | null>(null)
  const saveTimer = useRef<number | null>(null)
  const onChangeRef = useRef(onChange)
  const reportRef = useRef(report)
  onChangeRef.current = onChange
  reportRef.current = report

  useEffect(() => {
    setReport(normalizeCameraReport(value))
  }, [value])

  function clearPendingSave() {
    if (saveTimer.current != null) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
  }

  function flushPendingSave() {
    clearPendingSave()
    onChangeRef.current(reportRef.current)
  }

  function queueSave(next: CameraReport) {
    reportRef.current = next
    clearPendingSave()
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null
      onChangeRef.current(next)
    }, 200)
  }

  function maybeScheduleFileSave(next: CameraReport) {
    if (!settings || !getCameraReportSaveFolder(settings)) return
    scheduleCameraReportAutoSave(settings, next, archive)
  }

  async function runFileSave(
    nextSettings: NonNullable<typeof settings>,
    nextReport: CameraReport = report,
  ) {
    const result = await flushCameraReportAutoSave(
      nextSettings,
      nextReport,
      archive,
    )
    if (result.ok) {
      onToast?.(`נשמר: ${result.path ?? 'קובץ Excel חודשי'}`)
    } else if (result.error && result.error !== 'nothing_pending') {
      onToast?.(`שגיאת שמירה: ${result.error}`)
    }
    return result
  }

  function patch(partial: Partial<CameraReport>) {
    setReport((prev) => {
      const next = normalizeCameraReport({ ...prev, ...partial })
      queueSave(next)
      maybeScheduleFileSave(next)
      return next
    })
  }

  function switchContext(date: string, shift: ShiftKind) {
    clearPendingSave()
    const current = reportRef.current
    onShiftContextChange?.(date, shift, current)
  }

  function handleDateChange(date: string) {
    switchContext(date.replace(/\//g, '.'), report.shift)
  }

  function handlePreviewDaySelect(day: number) {
    const parsed = parseShiftReportDate(report.date)
    if (!parsed) return
    const dd = String(day).padStart(2, '0')
    const mm = String(parsed.month).padStart(2, '0')
    handleDateChange(`${dd}.${mm}.${parsed.year}`)
  }

  function handleShiftChange(shift: ShiftKind) {
    switchContext(report.date, shift)
  }

  function resetTemplate() {
    const ok = window.confirm(
      'לעבור למשמרת הבאה בתבנית חדשה?\nבוקר → צוהריים → לילה → בוקר של היום הבא',
    )
    if (!ok) return
    flushPendingSave()
    onChangeRef.current(reportRef.current)
    const { date, shift } = getNextShiftContext(
      reportRef.current.date,
      reportRef.current.shift,
    )
    const next = createEmptyCameraReport(new Date(), shift, date)
    setReport(next)
    onChangeRef.current(next)
  }

  function addScan() {
    setReport((prev) => {
      const next = normalizeCameraReport({
        ...prev,
        scans: [...prev.scans, createNextScanEntry(createId(), prev)],
      })
      queueSave(next)
      maybeScheduleFileSave(next)
      return next
    })
  }

  function updateScan(
    id: string,
    field: 'start' | 'end',
    value: string,
  ) {
    setReport((prev) => {
      const next = normalizeCameraReport({
        ...prev,
        scans: prev.scans.map((row) =>
          row.id === id ? { ...row, [field]: value } : row,
        ),
      })
      queueSave(next)
      maybeScheduleFileSave(next)
      return next
    })
  }

  function removeScan(id: string) {
    setReport((prev) => {
      const next = normalizeCameraReport({
        ...prev,
        scans: prev.scans.filter((row) => row.id !== id),
      })
      queueSave(next)
      maybeScheduleFileSave(next)
      return next
    })
  }

  async function pickSaveFolder() {
    if (!window.listeApi?.pickFolder) return
    const result = await window.listeApi.pickFolder()
    if (!result.ok || result.canceled || !result.path) return
    onSettingsChange?.({ cameraReportSaveFolder: result.path })
    const nextSettings = { ...settings!, cameraReportSaveFolder: result.path }
    await runFileSave(nextSettings)
  }

  async function handleSaveFolderCommit(folderValue: string) {
    if (!settings) return
    const trimmed = folderValue.trim()
    if (!trimmed) return
    const nextSettings = { ...settings, cameraReportSaveFolder: trimmed }
    await runFileSave(nextSettings)
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
      case 'no_workbook':
        return 'לא נמצא קובץ Excel לחודש זה'
      case 'workbook_build_failed':
        return 'יצירת קובץ Excel נכשלה'
      default:
        return error ?? 'שגיאה'
    }
  }

  async function sendMonthlyEmail(options?: { force?: boolean }) {
    if (sendingEmail) return
    const parsed = parseShiftReportDate(report.date)
    if (!parsed) {
      onToast?.('תאריך לא תקין')
      return
    }
    const directorEmail = settings?.directorEmail?.trim()
    const smtpHost = settings?.shiftReportSmtpHost?.trim()
    const smtpUser = settings?.shiftReportSmtpUser?.trim()
    const smtpPass = settings?.shiftReportSmtpPass ?? ''
    if (!directorEmail || !smtpHost || !smtpUser || !smtpPass) {
      onToast?.('יש למלא אימייל מנהל, שרת SMTP, משתמש וסיסמה')
      return
    }
    if (!getCameraReportSaveFolder(settings)) {
      onToast?.('יש לבחור תיקיית שמירה')
      return
    }
    if (!window.listeApi?.sendCameraMonthlyEmail) {
      onToast?.('שליחת דוא״ל אינה זמינה')
      return
    }
    setSendingEmail(true)
    try {
      const result = await window.listeApi.sendCameraMonthlyEmail({
        year: parsed.year,
        month: parsed.month,
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

  useEffect(() => {
    return () => {
      flushPendingSave()
    }
  }, [])

  const sortedScans = sortScansByTime(
    report.scans.filter((s) => s.start.trim() || s.end.trim()),
  )
  const draftScans = report.scans

  return (
    <div className="shift-report-page">
      <header className="main-header">
        <div className="brand">
          <h1>דוח מצלמות</h1>
          <p>סריקות מצלמות לפי משמרת — בוקר, צוהריים, לילה</p>
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
        <div className="shift-report camera-report">

      {showSettings ? (
        <section className="shift-section shift-settings-card">
          <h3>שמירה אוטומטית — דוח מצלמות</h3>
          <div className="shift-settings-grid">
            <label className="shift-field shift-settings-path">
              <span>תיקיית שמירה</span>
              <div className="shift-settings-path-row">
                <input
                  type="text"
                  value={settings?.cameraReportSaveFolder ?? ''}
                  placeholder={
                    settings?.shiftReportSaveFolder?.trim() ||
                    'C:\\Reports\\camera-reports'
                  }
                  onChange={(e) =>
                    onSettingsChange?.({
                      cameraReportSaveFolder: e.target.value,
                    })
                  }
                  onBlur={(e) => void handleSaveFolderCommit(e.target.value)}
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
              <span>שעת שליחה חודשית (1 בחודש)</span>
              <input
                type="time"
                value={settings?.cameraReportEmailTime ?? '07:00'}
                onChange={(e) =>
                  onSettingsChange?.({
                    cameraReportEmailTime: e.target.value,
                  })
                }
              />
            </label>
            <label className="shift-field">
              <span>מצב שליחה</span>
              <select
                value={settings?.cameraReportEmailMode ?? 'auto'}
                onChange={(e) =>
                  onSettingsChange?.({
                    cameraReportEmailMode:
                      e.target.value === 'manual' ? 'manual' : 'auto',
                  })
                }
              >
                <option value="auto">אוטומטית (1 בחודש בשעה שנקבעה)</option>
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
              onClick={() => void sendMonthlyEmail()}
              disabled={sendingEmail}
            >
              {sendingEmail ? 'שולח…' : 'שלח יומן במייל'}
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
          </div>
        </section>
      ) : null}

      <section className="shift-section shift-title-block">
        <h2>דוח מצלמות</h2>
      </section>

      <section className="shift-section shift-meta-card">
        <CameraDayStatusRow
          date={report.date}
          archive={archive}
          current={report}
          onSelectShift={handleShiftChange}
        />
        <div className="shift-meta-grid">
          <label className="shift-field">
            <span>תאריך</span>
            <input
              type="text"
              value={report.date}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                handleDateChange(e.target.value)
              }
              placeholder="DD.MM.YYYY"
            />
          </label>
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
          <div className="camera-guard-hours-row">
            <GuardNameField
              label="שם המאבטח/ת"
              value={report.guardName}
              names={guardNameSuggestions}
              placeholder="שם המדווח"
              onChange={(guardName) => patch({ guardName })}
            />
            <label className="shift-field camera-shift-hours-field">
              <span>שעות משמרת</span>
              <div className="camera-shift-hours-edit">
                <input
                  type="time"
                  value={report.shiftStart}
                  onChange={(e) => patch({ shiftStart: e.target.value })}
                />
                <span className="camera-shift-hours-sep">–</span>
                <input
                  type="time"
                  value={report.shiftEnd}
                  onChange={(e) => patch({ shiftEnd: e.target.value })}
                />
                <button
                  type="button"
                  className="btn btn-ghost camera-shift-hours-reset"
                  title="איפוס לברירת מחדל"
                  onClick={() => {
                    const defaults = getShiftDefaultHours(report.shift)
                    patch({
                      shiftStart: defaults.start,
                      shiftEnd: defaults.end,
                    })
                  }}
                >
                  ברירת מחדל
                </button>
              </div>
            </label>
          </div>
        </div>
      </section>

      <section className="shift-section">
        <div className="shift-section-head">
          <h3>סריקות מצלמות — {SHIFT_LABELS[report.shift]}</h3>
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: 'auto' }}
            onClick={addScan}
          >
            הוסף סריקה
          </button>
        </div>
        <p className="shift-settings-note">
          הזינו שעת התחלה ושעת סיום לכל סריקה (כל שורה = סריקה אחת).
        </p>
        <div className="shift-table-wrap">
          <table className="shift-table camera-scan-table">
            <thead>
              <tr>
                <th className="col-num">מס׳</th>
                <th className="col-time">התחלה</th>
                <th className="col-time">סיום</th>
                <th className="col-actions"> </th>
              </tr>
            </thead>
            <tbody>
              {draftScans.length === 0 ? (
                <tr>
                  <td colSpan={4} className="camera-scan-empty">
                    אין סריקות — לחצו «הוסף סריקה»
                  </td>
                </tr>
              ) : (
                draftScans.map((row, index) => (
                  <ScanRow
                    key={row.id}
                    index={index}
                    row={row}
                    onChange={(field, value) => updateScan(row.id, field, value)}
                    onRemove={() => removeScan(row.id)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
        {sortedScans.length > 0 ? (
          <p className="camera-scan-summary">
            {sortedScans.length} סריקות ·{' '}
            {sortedScans.map((s) => formatScanRange(s)).filter(Boolean).join(', ')}
          </p>
        ) : null}
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
                    תצוגה מקדימה · יומן מצלמות (Excel)
                  </span>
                  <div className="preview-layout-controls">
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
                <div className="shift-preview-shell camera-xls-preview-shell">
                  <CameraReportExcelPreview
                    report={report}
                    archive={archive}
                    onDaySelect={handlePreviewDaySelect}
                  />
                </div>
              </div>
            </div>,
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
              onResend={() => void sendMonthlyEmail({ force: true })}
            />,
            document.body,
          )
        : null}
    </div>
  )
}

function ScanRow({
  index,
  row,
  onChange,
  onRemove,
}: {
  index: number
  row: CameraScanEntry
  onChange: (field: 'start' | 'end', value: string) => void
  onRemove: () => void
}) {
  return (
    <tr>
      <td className="col-num">{index + 1}</td>
      <td className="col-time">
        <input
          type="time"
          value={row.start}
          onChange={(e) => onChange('start', e.target.value)}
        />
      </td>
      <td className="col-time">
        <input
          type="time"
          value={row.end}
          onChange={(e) => onChange('end', e.target.value)}
        />
      </td>
      <td className="col-actions">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onRemove}
          aria-label="הסר סריקה"
        >
          הסר
        </button>
      </td>
    </tr>
  )
}
