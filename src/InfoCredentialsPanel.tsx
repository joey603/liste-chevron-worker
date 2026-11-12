import { FormEvent, useMemo, useState } from 'react'
import {
  createId,
  formatDateTime,
  infoCredentialDisplayTitle,
  type InfoCredential,
} from './types'

const emptyForm = {
  title: '',
  username: '',
  password: '',
  notes: '',
}

type FormState = typeof emptyForm

type Props = {
  entries: InfoCredential[]
  onChange: (next: InfoCredential[], message?: string) => void | Promise<void>
  onToast?: (message: string) => void
  toastMessage?: string | null
}

export default function InfoCredentialsPanel({
  entries,
  onChange,
  onToast,
  toastMessage,
}: Props) {
  const [showAdd, setShowAdd] = useState(false)
  const [draft, setDraft] = useState<FormState>(emptyForm)
  const [editing, setEditing] = useState<InfoCredential | null>(null)
  const [revealedIds, setRevealedIds] = useState<Record<string, boolean>>({})
  const [revealDraftPassword, setRevealDraftPassword] = useState(false)
  const [revealEditPassword, setRevealEditPassword] = useState(false)
  const [search, setSearch] = useState('')

  const sorted = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = [...entries].sort((a, b) =>
      infoCredentialDisplayTitle(a).localeCompare(
        infoCredentialDisplayTitle(b),
        'he',
      ),
    )
    if (!q) return list
    return list.filter((entry) => {
      const hay = [entry.title, entry.username, entry.notes, entry.password]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [entries, search])

  function resetDraft() {
    setDraft(emptyForm)
    setRevealDraftPassword(false)
  }

  function toggleReveal(id: string) {
    setRevealedIds((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  async function copyText(label: string, value: string) {
    const text = value.trim()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      onToast?.(`${label} הועתק`)
    } catch {
      onToast?.('ההעתקה נכשלה')
    }
  }

  function submitAdd(e: FormEvent) {
    e.preventDefault()
    const title = draft.title.trim()
    const username = draft.username.trim()
    const password = draft.password
    const notes = draft.notes.trim()
    if (!title && !username && !password && !notes) return

    const next: InfoCredential = {
      id: createId(),
      title,
      username,
      password,
      email: '',
      notes,
      updatedAt: new Date().toISOString(),
    }
    void onChange([...entries, next], 'פרטי המידע נשמרו')
    resetDraft()
    setShowAdd(false)
  }

  function submitEdit(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    const title = editing.title.trim()
    const username = editing.username.trim()
    const password = editing.password
    const notes = editing.notes.trim()
    if (!title && !username && !password && !notes) return

    const next = entries.map((entry) =>
      entry.id === editing.id
        ? {
            ...editing,
            title,
            username,
            password,
            email: '',
            notes,
            updatedAt: new Date().toISOString(),
          }
        : entry,
    )
    void onChange(next, 'פרטי המידע עודכנו')
    setEditing(null)
    setRevealEditPassword(false)
  }

  function removeEntry(entry: InfoCredential) {
    const label = infoCredentialDisplayTitle(entry)
    if (!window.confirm(`להסיר את «${label}»?`)) return
    void onChange(
      entries.filter((item) => item.id !== entry.id),
      'הפריט הוסר',
    )
  }

  function renderFormFields(
    value: FormState | InfoCredential,
    setValue: (next: FormState | InfoCredential) => void,
    options: {
      idPrefix: string
      revealPassword: boolean
      onTogglePassword: () => void
    },
  ) {
    return (
      <>
        <div className="field">
          <label htmlFor={`${options.idPrefix}-title`}>כותרת / מערכת</label>
          <input
            id={`${options.idPrefix}-title`}
            value={value.title}
            onChange={(e) => setValue({ ...value, title: e.target.value })}
            placeholder="למשל מחשב מצלמות, Gmail, Wi‑Fi"
            autoFocus
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor={`${options.idPrefix}-user`}>
            שם משתמש (אופציונלי)
          </label>
          <input
            id={`${options.idPrefix}-user`}
            value={value.username}
            onChange={(e) => setValue({ ...value, username: e.target.value })}
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor={`${options.idPrefix}-pass`}>
            סיסמה (אופציונלי)
          </label>
          <div className="info-password-field">
            <input
              id={`${options.idPrefix}-pass`}
              type={options.revealPassword ? 'text' : 'password'}
              value={value.password}
              onChange={(e) =>
                setValue({ ...value, password: e.target.value })
              }
              autoComplete="new-password"
            />
            <button
              type="button"
              className="btn btn-ghost info-password-toggle"
              onClick={options.onTogglePassword}
            >
              {options.revealPassword ? 'הסתר' : 'הצג'}
            </button>
          </div>
        </div>
        <div className="field">
          <label htmlFor={`${options.idPrefix}-notes`}>הערות / אחר</label>
          <textarea
            id={`${options.idPrefix}-notes`}
            value={value.notes}
            onChange={(e) => setValue({ ...value, notes: e.target.value })}
            rows={3}
            placeholder="קישור, טלפון, קוד, הערה…"
          />
        </div>
      </>
    )
  }

  return (
    <main className="main-panel banned-panel info-credentials-panel">
      <header className="main-header">
        <div className="brand">
          <h1>מידע</h1>
          <p>כותרות, סיסמאות ופרטים נוספים — נשמרים מקומית בלבד</p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          style={{ width: 'auto' }}
          onClick={() => {
            resetDraft()
            setShowAdd(true)
          }}
        >
          + הוספת פרט
        </button>
      </header>

      <div className="panel banned-list-panel">
        <div className="info-credentials-toolbar">
          <label className="field info-credentials-search">
            <span className="info-search-label">חיפוש</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חיפוש לפי כותרת, משתמש, הערה…"
              autoComplete="off"
            />
          </label>
        </div>

        {sorted.length === 0 ? (
          <div className="banned-empty">
            {entries.length === 0
              ? 'אין פרטי מידע עדיין. לחצו על «הוספת פרט».'
              : 'לא נמצאו תוצאות לחיפוש.'}
          </div>
        ) : (
          <div className="banned-list">
            {sorted.map((entry, index) => {
              const revealed = Boolean(revealedIds[entry.id])
              return (
                <article key={entry.id} className="banned-row info-credential-row">
                  <div className="banned-main">
                    <div className="banned-name">
                      <span className="person-index">{index + 1}.</span>
                      {infoCredentialDisplayTitle(entry)}
                    </div>
                    <div className="info-credential-fields">
                      {entry.username ? (
                        <div className="info-credential-line">
                          <span className="info-credential-label">משתמש</span>
                          <span className="info-credential-value" dir="ltr">
                            {entry.username}
                          </span>
                          <button
                            type="button"
                            className="btn btn-ghost info-copy-btn"
                            onClick={() =>
                              void copyText('שם המשתמש', entry.username)
                            }
                          >
                            העתק
                          </button>
                        </div>
                      ) : null}
                      {entry.password ? (
                        <div className="info-credential-line">
                          <span className="info-credential-label">סיסמה</span>
                          <span className="info-credential-value" dir="ltr">
                            {revealed ? entry.password : '••••••••'}
                          </span>
                          <button
                            type="button"
                            className="btn btn-ghost info-copy-btn"
                            onClick={() => toggleReveal(entry.id)}
                          >
                            {revealed ? 'הסתר' : 'הצג'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost info-copy-btn"
                            onClick={() =>
                              void copyText('הסיסמה', entry.password)
                            }
                          >
                            העתק
                          </button>
                        </div>
                      ) : null}
                      {entry.notes ? (
                        <div className="banned-reason info-credential-notes">
                          {entry.notes}
                        </div>
                      ) : null}
                    </div>
                    <div className="banned-meta">
                      עודכן {formatDateTime(entry.updatedAt)}
                    </div>
                  </div>
                  <div className="banned-actions">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => {
                        setRevealEditPassword(false)
                        setEditing({ ...entry })
                      }}
                    >
                      עריכה
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => removeEntry(entry)}
                    >
                      הסרה
                    </button>
                  </div>
                </article>
              )
            })}
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
            <h3>הוספת פרט מידע</h3>
            <form onSubmit={submitAdd}>
              {renderFormFields(draft, (next) => setDraft(next as FormState), {
                idPrefix: 'info-add',
                revealPassword: revealDraftPassword,
                onTogglePassword: () =>
                  setRevealDraftPassword((v) => !v),
              })}
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
                  שמירה
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {editing ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            setEditing(null)
            setRevealEditPassword(false)
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>עריכת פרט מידע</h3>
            <form onSubmit={submitEdit}>
              {renderFormFields(
                editing,
                (next) => setEditing(next as InfoCredential),
                {
                  idPrefix: 'info-edit',
                  revealPassword: revealEditPassword,
                  onTogglePassword: () =>
                    setRevealEditPassword((v) => !v),
                },
              )}
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setEditing(null)
                    setRevealEditPassword(false)
                  }}
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
