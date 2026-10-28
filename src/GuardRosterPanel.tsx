import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  captureElementToPng,
  restoreUiInteractivity,
} from './captureDomToPng'
import {
  createId,
  formatDateTime,
  guardDisplayName,
  type GuardRosterEntry,
} from './types'
import { sendTelegramPhoto } from './webRelay'

const emptyGuard = {
  firstName: '',
  lastName: '',
  phone: '',
  address: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  job: 'guard',
  company: 'G1',
  shift: '',
  idCard: '',
}

type GuardForm = typeof emptyGuard

type Props = {
  guards: GuardRosterEntry[]
  onChange: (next: GuardRosterEntry[], message?: string) => void | Promise<void>
  onToast?: (message: string) => void
  toastMessage?: string | null
  siteName?: string
  excelPath?: string
  onExcelPathChange?: (path: string) => void | Promise<void>
}

export default function GuardRosterPanel({
  guards,
  onChange,
  onToast,
  toastMessage,
  siteName = 'אתר Chevron',
  excelPath = '',
  onExcelPathChange,
}: Props) {
  const [showAdd, setShowAdd] = useState(false)
  const [draft, setDraft] = useState<GuardForm>(emptyGuard)
  const [editing, setEditing] = useState<GuardRosterEntry | null>(null)
  const [sending, setSending] = useState(false)
  const [excelBusy, setExcelBusy] = useState(false)
  const captureRef = useRef<HTMLDivElement>(null)
  const excelPathRef = useRef(excelPath)
  const skipNextExcelWriteRef = useRef(false)
  const excelWriteTimer = useRef<number | null>(null)
  excelPathRef.current = excelPath

  const sorted = useMemo(
    () =>
      [...guards].sort((a, b) =>
        guardDisplayName(a).localeCompare(guardDisplayName(b), 'he'),
      ),
    [guards],
  )

  function notify(message: string) {
    onToast?.(message)
  }

  function resetDraft() {
    setDraft(emptyGuard)
  }

  async function writeExcelNow(nextGuards: GuardRosterEntry[], pathOverride?: string) {
    const filePath = (pathOverride ?? excelPathRef.current).trim()
    if (!filePath || !window.listeApi?.writeGuardRosterExcel) return
    const result = await window.listeApi.writeGuardRosterExcel({
      filePath,
      guards: nextGuards,
    })
    if (!result.ok) {
      if (result.error === 'file_locked') {
        notify('קובץ ה־Excel פתוח — סגרו אותו ושמרו שוב')
      } else {
        notify(`שמירת Excel נכשלה${result.error ? `: ${result.error}` : ''}`)
      }
    }
  }

  useEffect(() => {
    if (skipNextExcelWriteRef.current) {
      skipNextExcelWriteRef.current = false
      return
    }
    if (!excelPath.trim() || !window.listeApi?.writeGuardRosterExcel) return
    if (excelWriteTimer.current != null) {
      window.clearTimeout(excelWriteTimer.current)
    }
    excelWriteTimer.current = window.setTimeout(() => {
      excelWriteTimer.current = null
      void writeExcelNow(guards)
    }, 700)
    return () => {
      if (excelWriteTimer.current != null) {
        window.clearTimeout(excelWriteTimer.current)
        excelWriteTimer.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync Excel on guards/path only
  }, [guards, excelPath])

  async function pickExcelFile() {
    if (!window.listeApi?.pickGuardRosterExcel) {
      notify('בחירת קובץ זמינה רק באפליקציה המותקנת')
      return
    }
    setExcelBusy(true)
    try {
      const picked = await window.listeApi.pickGuardRosterExcel()
      if (!picked.ok || !picked.path) return
      await loadFromExcel(picked.path, true)
    } finally {
      setExcelBusy(false)
      restoreUiInteractivity()
    }
  }

  async function loadFromExcel(filePath: string, replaceList: boolean) {
    if (!window.listeApi?.readGuardRosterExcel) {
      notify('קריאת Excel זמינה רק באפליקציה המותקנת')
      return
    }
    const result = await window.listeApi.readGuardRosterExcel(filePath)
    if (!result.ok) {
      notify(
        result.error === 'not_found'
          ? 'קובץ ה־Excel לא נמצא'
          : `טעינת Excel נכשלה${result.error ? `: ${result.error}` : ''}`,
      )
      return
    }
    skipNextExcelWriteRef.current = true
    await onExcelPathChange?.(filePath)
    if (replaceList || guards.length === 0) {
      await onChange(
        result.guards,
        `נטענו ${result.guards.length} שומרים מקובץ ה־Excel`,
      )
    } else {
      notify('נתיב ה־Excel נשמר — הרשימה הקיימת לא הוחלפה')
    }
  }

  async function reloadExcel() {
    const filePath = excelPath.trim()
    if (!filePath) {
      notify('בחרו קובץ Excel תחילה')
      return
    }
    setExcelBusy(true)
    try {
      await loadFromExcel(filePath, true)
    } finally {
      setExcelBusy(false)
    }
  }

  async function saveExcelNow() {
    const filePath = excelPath.trim()
    if (!filePath) {
      notify('בחרו קובץ Excel תחילה')
      return
    }
    setExcelBusy(true)
    try {
      await writeExcelNow(guards, filePath)
      notify('הרוסטר נשמר לקובץ ה־Excel')
    } finally {
      setExcelBusy(false)
    }
  }

  async function captureRosterImageDataUrl(): Promise<string | null> {
    const source = captureRef.current
    if (!source) return null

    try {
      return await captureElementToPng(source, {
        minWidth: 720,
        prepareClone: (clone) => {
          clone.style.padding = '20px'
          clone
            .querySelectorAll<HTMLElement>('.banned-actions, .banned-meta, .toast')
            .forEach((node) => {
              node.remove()
            })
          clone
            .querySelectorAll<HTMLElement>('.roster-capture-heading')
            .forEach((node) => {
              node.style.display = 'block'
              node.style.marginBottom = '14px'
              node.style.fontSize = '1.15rem'
              node.style.color = '#003b70'
            })
          clone
            .querySelectorAll<HTMLElement>('.banned-list, .roster-list')
            .forEach((node) => {
              node.style.overflow = 'visible'
              node.style.maxHeight = 'none'
              node.style.height = 'auto'
            })
        },
      })
    } finally {
      restoreUiInteractivity()
    }
  }

  /** שליחת תמונת הרוסטר לקבוצת Telegram */
  async function shareRosterOnTelegram() {
    if (guards.length === 0) {
      notify('אין שומרים ברוסטר לשליחה')
      return
    }
    setSending(true)
    try {
      const dataUrl = await captureRosterImageDataUrl()
      if (!dataUrl) {
        notify('שגיאה ביצירת התמונה')
        return
      }
      notify('שולח את התמונה ב־Telegram…')
      const result = await sendTelegramPhoto(
        dataUrl,
        `רוסטר שומרים — ${siteName}`,
      )
      if (!result.ok) {
        if (result.error === 'telegram_not_configured') {
          notify('הגדירו Token ו-chat_id של Telegram בהגדרות נוכחות')
        } else if (result.error === 'offline') {
          notify('אין אינטרנט — לא ניתן לשלוח כרגע')
        } else {
          notify('שליחת התמונה נכשלה')
        }
        return
      }
      notify('התמונה נשלחה ב־Telegram')
    } catch {
      notify('שגיאה בשליחת התמונה')
    } finally {
      setSending(false)
      restoreUiInteractivity()
    }
  }

  function validate(form: GuardForm): string | null {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      return 'שם פרטי ושם משפחה חובה'
    }
    return null
  }

  async function createGuard(e: FormEvent) {
    e.preventDefault()
    const error = validate(draft)
    if (error) {
      await onChange(guards, error)
      return
    }
    const firstName = draft.firstName.trim()
    const lastName = draft.lastName.trim()
    const exists = guards.some(
      (g) =>
        g.firstName.toLowerCase() === firstName.toLowerCase() &&
        g.lastName.toLowerCase() === lastName.toLowerCase(),
    )
    if (exists) {
      await onChange(guards, 'השומר/ת כבר קיים/ת ברוסטר')
      return
    }
    const entry: GuardRosterEntry = {
      id: createId(),
      firstName,
      lastName,
      phone: draft.phone.trim(),
      address: draft.address.trim(),
      emergencyContactName: draft.emergencyContactName.trim(),
      emergencyContactPhone: draft.emergencyContactPhone.trim(),
      job: draft.job.trim() || 'guard',
      company: draft.company.trim() || 'G1',
      shift: draft.shift.trim(),
      idCard: draft.idCard.trim(),
      addedAt: new Date().toISOString(),
    }
    await onChange(
      [...guards, entry],
      `${guardDisplayName(entry)} נוסף/ה לרוסטר`,
    )
    setShowAdd(false)
    resetDraft()
  }

  async function saveEdited(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    const form: GuardForm = {
      firstName: editing.firstName,
      lastName: editing.lastName,
      phone: editing.phone,
      address: editing.address,
      emergencyContactName: editing.emergencyContactName,
      emergencyContactPhone: editing.emergencyContactPhone,
      job: editing.job || 'guard',
      company: editing.company || 'G1',
      shift: editing.shift || '',
      idCard: editing.idCard || '',
    }
    const error = validate(form)
    if (error) {
      await onChange(guards, error)
      return
    }
    const firstName = form.firstName.trim()
    const lastName = form.lastName.trim()
    const duplicate = guards.some(
      (g) =>
        g.id !== editing.id &&
        g.firstName.toLowerCase() === firstName.toLowerCase() &&
        g.lastName.toLowerCase() === lastName.toLowerCase(),
    )
    if (duplicate) {
      await onChange(guards, 'שומר/ת עם שם זה כבר קיים/ת ברוסטר')
      return
    }
    const next = guards.map((g) =>
      g.id === editing.id
        ? {
            ...editing,
            firstName,
            lastName,
            phone: form.phone.trim(),
            address: form.address.trim(),
            emergencyContactName: form.emergencyContactName.trim(),
            emergencyContactPhone: form.emergencyContactPhone.trim(),
            job: form.job.trim() || 'guard',
            company: form.company.trim() || 'G1',
            shift: form.shift.trim(),
            idCard: form.idCard.trim(),
          }
        : g,
    )
    await onChange(next, 'הרשומה עודכנה')
    setEditing(null)
  }

  async function removeGuard(entry: GuardRosterEntry) {
    if (
      !window.confirm(`להסיר את ${guardDisplayName(entry)} מהרוסטר?`)
    ) {
      return
    }
    await onChange(
      guards.filter((g) => g.id !== entry.id),
      'הרשומה הוסרה',
    )
  }

  function renderFormFields(
    values: GuardForm,
    setValues: (updater: (prev: GuardForm) => GuardForm) => void,
    idPrefix: string,
  ) {
    return (
      <>
        <div className="row-2">
          <div className="field">
            <label htmlFor={`${idPrefix}-first`}>שם פרטי</label>
            <input
              id={`${idPrefix}-first`}
              value={values.firstName}
              onChange={(e) =>
                setValues((s) => ({ ...s, firstName: e.target.value }))
              }
              placeholder="ישראל"
              autoFocus
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor={`${idPrefix}-last`}>שם משפחה</label>
            <input
              id={`${idPrefix}-last`}
              value={values.lastName}
              onChange={(e) =>
                setValues((s) => ({ ...s, lastName: e.target.value }))
              }
              placeholder="ישראלי"
              autoComplete="off"
            />
          </div>
        </div>
        <div className="row-2">
          <div className="field">
            <label htmlFor={`${idPrefix}-phone`}>מספר טלפון</label>
            <input
              id={`${idPrefix}-phone`}
              value={values.phone}
              onChange={(e) =>
                setValues((s) => ({ ...s, phone: e.target.value }))
              }
              placeholder="050-0000000"
              inputMode="tel"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor={`${idPrefix}-idcard`}>תעודת זהות</label>
            <input
              id={`${idPrefix}-idcard`}
              value={values.idCard}
              onChange={(e) =>
                setValues((s) => ({ ...s, idCard: e.target.value }))
              }
              placeholder="000000000"
              autoComplete="off"
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-address`}>כתובת</label>
          <input
            id={`${idPrefix}-address`}
            value={values.address}
            onChange={(e) =>
              setValues((s) => ({ ...s, address: e.target.value }))
            }
            placeholder="רחוב, עיר"
            autoComplete="off"
          />
        </div>
        <div className="row-2">
          <div className="field">
            <label htmlFor={`${idPrefix}-job`}>תפקיד (Job)</label>
            <input
              id={`${idPrefix}-job`}
              value={values.job}
              onChange={(e) =>
                setValues((s) => ({ ...s, job: e.target.value }))
              }
              placeholder="guard"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor={`${idPrefix}-company`}>חברה (Company)</label>
            <input
              id={`${idPrefix}-company`}
              value={values.company}
              onChange={(e) =>
                setValues((s) => ({ ...s, company: e.target.value }))
              }
              placeholder="G1"
              autoComplete="off"
            />
          </div>
        </div>
        <div className="roster-emergency-block">
          <h4>איש קשר לחירום</h4>
          <div className="row-2">
            <div className="field">
              <label htmlFor={`${idPrefix}-em-name`}>שם</label>
              <input
                id={`${idPrefix}-em-name`}
                value={values.emergencyContactName}
                onChange={(e) =>
                  setValues((s) => ({
                    ...s,
                    emergencyContactName: e.target.value,
                  }))
                }
                placeholder="שם איש הקשר"
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor={`${idPrefix}-em-phone`}>מספר טלפון</label>
              <input
                id={`${idPrefix}-em-phone`}
                value={values.emergencyContactPhone}
                onChange={(e) =>
                  setValues((s) => ({
                    ...s,
                    emergencyContactPhone: e.target.value,
                  }))
                }
                placeholder="050-0000000"
                inputMode="tel"
                autoComplete="off"
              />
            </div>
          </div>
        </div>
      </>
    )
  }

  return (
    <main className="main-panel banned-panel roster-panel">
      <header className="main-header">
        <div className="brand">
          <h1>רוסטר</h1>
          <p>רשימת שומרים — מסונכרן עם קובץ Excel</p>
        </div>
        <div className="main-header-actions">
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: 'auto' }}
            disabled={sending || sorted.length === 0}
            onClick={() => void shareRosterOnTelegram()}
            title="שליחת תמונת הרוסטר לקבוצת Telegram"
          >
            {sending ? 'שולח…' : 'שליחה ב־Telegram'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: 'auto' }}
            onClick={() => {
              resetDraft()
              setShowAdd(true)
            }}
          >
            + הוספת שומר/ת
          </button>
        </div>
      </header>

      <div className="roster-excel-bar">
        <input
          id="roster-excel-path"
          className="roster-excel-path-input"
          value={excelPath}
          readOnly
          placeholder="קובץ Excel — לחצו «בחר קובץ»"
          aria-label="קובץ Excel (רוסטר צרעה)"
          dir="ltr"
          title={excelPath || 'לא נבחר קובץ'}
        />
        <div className="roster-excel-actions">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={excelBusy}
            onClick={() => void pickExcelFile()}
          >
            בחר קובץ
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={excelBusy || !excelPath.trim()}
            onClick={() => void reloadExcel()}
          >
            טען מהקובץ
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: 'auto' }}
            disabled={excelBusy || !excelPath.trim()}
            onClick={() => void saveExcelNow()}
          >
            שמור ל־Excel
          </button>
        </div>
      </div>

      <div className="panel banned-list-panel roster-list-panel">
        {sorted.length === 0 ? (
          <div className="banned-empty">
            אין שומרים ברוסטר.
            <br />
            לחצו על «הוספת שומר/ת» כדי להוסיף.
          </div>
        ) : (
          <div
            className="roster-capture-root"
            ref={captureRef}
          >
            <div className="roster-capture-heading">
              <strong>רוסטר שומרים — {siteName}</strong>
            </div>
            <div className="banned-list roster-list">
              {sorted.map((entry, index) => (
                <article key={entry.id} className="banned-row roster-row">
                  <div className="banned-main">
                    <div className="banned-name">
                      <span className="person-index">{index + 1}.</span>
                      {guardDisplayName(entry)}
                    </div>
                    <div className="banned-details roster-details">
                      {entry.phone ? (
                        <span>טלפון: {entry.phone}</span>
                      ) : (
                        <span className="muted">ללא טלפון</span>
                      )}
                      {entry.idCard ? (
                        <span>ת.ז.: {entry.idCard}</span>
                      ) : null}
                      {entry.address ? (
                        <span>כתובת: {entry.address}</span>
                      ) : null}
                      {entry.company ? (
                        <span>חברה: {entry.company}</span>
                      ) : null}
                    </div>
                    {(entry.emergencyContactName ||
                      entry.emergencyContactPhone) && (
                      <div className="roster-emergency-line">
                        <strong>איש קשר לחירום:</strong>{' '}
                        {entry.emergencyContactName || '—'}
                        {entry.emergencyContactPhone
                          ? ` · ${entry.emergencyContactPhone}`
                          : ''}
                      </div>
                    )}
                    <div className="banned-meta">
                      נוסף {formatDateTime(entry.addedAt)}
                    </div>
                  </div>
                  <div className="banned-actions">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setEditing({ ...entry })}
                    >
                      עריכה
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => void removeGuard(entry)}
                    >
                      הסרה
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
        {toastMessage ? <div className="toast">{toastMessage}</div> : null}
      </div>

      {showAdd ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            setShowAdd(false)
            resetDraft()
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>הוספת שומר/ת</h3>
            <form onSubmit={(e) => void createGuard(e)}>
              {renderFormFields(draft, setDraft, 'roster-add')}
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setShowAdd(false)
                    resetDraft()
                  }}
                >
                  ביטול
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ width: 'auto' }}
                >
                  הוספה לרוסטר
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {editing ? (
        <div
          className="modal-backdrop"
          onClick={() => setEditing(null)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>עריכת שומר/ת</h3>
            <form onSubmit={(e) => void saveEdited(e)}>
              {renderFormFields(
                {
                  firstName: editing.firstName,
                  lastName: editing.lastName,
                  phone: editing.phone,
                  address: editing.address,
                  emergencyContactName: editing.emergencyContactName,
                  emergencyContactPhone: editing.emergencyContactPhone,
                  job: editing.job || 'guard',
                  company: editing.company || 'G1',
                  shift: editing.shift || '',
                  idCard: editing.idCard || '',
                },
                (updater) => {
                  setEditing((prev) => {
                    if (!prev) return prev
                    const next = updater({
                      firstName: prev.firstName,
                      lastName: prev.lastName,
                      phone: prev.phone,
                      address: prev.address,
                      emergencyContactName: prev.emergencyContactName,
                      emergencyContactPhone: prev.emergencyContactPhone,
                      job: prev.job || 'guard',
                      company: prev.company || 'G1',
                      shift: prev.shift || '',
                      idCard: prev.idCard || '',
                    })
                    return { ...prev, ...next }
                  })
                },
                'roster-edit',
              )}
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setEditing(null)}
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
      ) : null}

    </main>
  )
}
