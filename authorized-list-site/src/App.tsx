import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  apiErrorMessage,
  deletePerson,
  isDemoMode,
  listPeople,
  upsertPerson,
} from './api'
import ExpiresOnPicker from './ExpiresOnPicker'
import {
  parseRosterImage,
  type ParsedRosterPerson,
} from './parseRosterPhoto'
import { readSecretFromLocation } from './secret'
import {
  displayName,
  formatExpiresOnHe,
  kindLabel,
  type AuthorizedKind,
  type AuthorizedPerson,
} from './types'
import chevronLogo from './assets/chevron-logo.png'

type KindFilter = 'all' | AuthorizedKind

type Draft = {
  id?: string
  firstName: string
  lastName: string
  kind: AuthorizedKind
  notes: string
  expiresOn: string
}

type PhotoDraft = ParsedRosterPerson & {
  notes: string
  expiresOn: string
}

const emptyDraft = (): Draft => ({
  firstName: '',
  lastName: '',
  kind: 'permanent',
  notes: '',
  expiresOn: '',
})

function personNameKey(firstName: string, lastName: string): string {
  return `${firstName.trim().toLowerCase()}|${lastName.trim().toLowerCase()}`
}

function formatUpdatedAt(iso?: string): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('he-IL', {
      dateStyle: 'short',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

export default function App() {
  const [secret, setSecret] = useState<string | null>(() =>
    readSecretFromLocation(),
  )
  const [people, setPeople] = useState<AuthorizedPerson[]>([])
  const [updatedAt, setUpdatedAt] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [showForm, setShowForm] = useState(false)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoProgress, setPhotoProgress] = useState(0)
  const [photoPreview, setPhotoPreview] = useState<PhotoDraft[] | null>(null)

  useEffect(() => {
    const onHash = () => setSecret(readSecretFromLocation())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(t)
  }, [toast])

  const refresh = useCallback(async () => {
    if (!secret) return
    setLoading(true)
    setError(null)
    const result = await listPeople(secret)
    setLoading(false)
    if (!result.ok) {
      setError(apiErrorMessage(result.error))
      setPeople([])
      return
    }
    setPeople(result.people ?? [])
    setUpdatedAt(result.updatedAt)
    if ((result.expiredRemoved ?? 0) > 0) {
      setToast(`הוסרו ${result.expiredRemoved} שפג תוקפם`)
    }
  }, [secret])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return people
      .filter((p) => (kindFilter === 'all' ? true : p.kind === kindFilter))
      .filter((p) => {
        if (!q) return true
        const hay = `${p.firstName} ${p.lastName} ${p.notes}`.toLowerCase()
        return hay.includes(q)
      })
  }, [people, search, kindFilter])

  const counts = useMemo(() => {
    let permanent = 0
    let visitor = 0
    for (const p of people) {
      if (p.kind === 'visitor') visitor += 1
      else permanent += 1
    }
    return { all: people.length, permanent, visitor }
  }, [people])

  function openAdd() {
    setDraft(emptyDraft())
    setShowForm(true)
  }

  function openEdit(person: AuthorizedPerson) {
    setDraft({
      id: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      kind: person.kind,
      notes: person.notes,
      expiresOn: person.expiresOn || '',
    })
    setShowForm(true)
  }

  async function submitForm(e: FormEvent) {
    e.preventDefault()
    if (!secret) return
    const firstName = draft.firstName.trim()
    const lastName = draft.lastName.trim()
    if (!firstName && !lastName) {
      setToast('שם פרטי או שם משפחה נדרש')
      return
    }
    setBusy(true)
    const result = await upsertPerson(secret, {
      id: draft.id,
      firstName,
      lastName,
      kind: draft.kind,
      notes: draft.notes.trim(),
      expiresOn: draft.expiresOn.trim(),
    })
    setBusy(false)
    if (!result.ok) {
      setToast(apiErrorMessage(result.error))
      return
    }
    setPeople(result.people ?? [])
    setUpdatedAt(result.updatedAt)
    setShowForm(false)
    setDraft(emptyDraft())
    setToast(draft.id ? 'הרשומה עודכנה' : 'הרשומה נוספה')
  }

  async function onDelete(person: AuthorizedPerson) {
    if (!secret) return
    if (!window.confirm(`למחוק את «${displayName(person)}»?`)) return
    setBusy(true)
    const result = await deletePerson(secret, person.id)
    setBusy(false)
    if (!result.ok) {
      setToast(apiErrorMessage(result.error))
      return
    }
    setPeople(result.people ?? [])
    setUpdatedAt(result.updatedAt)
    setToast('הרשומה נמחקה')
  }

  async function onPhotoSelected(file: File | undefined) {
    if (!file || !secret) return
    setPhotoBusy(true)
    setPhotoProgress(0)
    setPhotoPreview(null)
    setError(null)
    try {
      const parsed = await parseRosterImage(file, (ratio) =>
        setPhotoProgress(Math.round(ratio * 100)),
      )
      if (parsed.length === 0) {
        setToast('לא זוהו שמות בתמונה — נסו צילום ברור יותר של הטבלה')
        return
      }
      setPhotoPreview(
        parsed.map((p) => ({
          ...p,
          notes: '',
          expiresOn: '',
        })),
      )
    } catch {
      setToast('קריאת התמונה נכשלה')
    } finally {
      setPhotoBusy(false)
      setPhotoProgress(0)
      if (photoInputRef.current) photoInputRef.current.value = ''
    }
  }

  const photoSplit = useMemo(() => {
    if (!photoPreview) {
      return { toAdd: [] as PhotoDraft[], already: [] as PhotoDraft[] }
    }
    const existing = new Set(
      people.map((p) => personNameKey(p.firstName, p.lastName)),
    )
    const toAdd: PhotoDraft[] = []
    const already: PhotoDraft[] = []
    for (const person of photoPreview) {
      const key = personNameKey(person.firstName, person.lastName)
      if (existing.has(key)) already.push(person)
      else toAdd.push(person)
    }
    return { toAdd, already }
  }, [photoPreview, people])

  function updatePhotoDraft(
    person: PhotoDraft,
    patch: Partial<Pick<PhotoDraft, 'notes' | 'expiresOn'>>,
  ) {
    setPhotoPreview((prev) => {
      if (!prev) return prev
      const key = personNameKey(person.firstName, person.lastName)
      return prev.map((row) =>
        personNameKey(row.firstName, row.lastName) === key
          ? { ...row, ...patch }
          : row,
      )
    })
  }

  async function confirmPhotoImport() {
    if (!secret || photoSplit.toAdd.length === 0) return
    setBusy(true)
    let added = 0
    let lastPeople = people
    let lastUpdated = updatedAt
    for (const person of photoSplit.toAdd) {
      const companyNote = person.company ? `Company: ${person.company}` : ''
      const notes = [person.notes.trim(), companyNote].filter(Boolean).join(' · ')
      const result = await upsertPerson(secret, {
        firstName: person.firstName,
        lastName: person.lastName,
        kind: person.kind,
        notes,
        expiresOn: person.expiresOn.trim(),
      })
      if (!result.ok) {
        setBusy(false)
        setToast(apiErrorMessage(result.error))
        return
      }
      added += 1
      lastPeople = result.people ?? lastPeople
      lastUpdated = result.updatedAt ?? lastUpdated
    }
    setPeople(lastPeople)
    setUpdatedAt(lastUpdated)
    setPhotoPreview(null)
    setBusy(false)
    const skipped = photoSplit.already.length
    setToast(
      skipped > 0
        ? `נוספו ${added} · דולגו ${skipped} שכבר ברשימה`
        : `נוספו ${added} מהתמונה`,
    )
  }

  if (!secret) {
    return (
      <div className="app-shell gate">
        <div className="gate-card">
          <img src={chevronLogo} alt="Chevron" className="gate-logo" />
          <h1>רשימת מורשים</h1>
          <p>
            הגישה לאתר זה היא באמצעות קישור סודי בלבד.
            <br />
            פתחו את הקישור שקיבלתם (כולל <code>#/s/…</code>).
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="top" dir="ltr">
        <div className="brand-row">
          <img src={chevronLogo} alt="Chevron" className="brand-logo" />
          <div className="brand" dir="rtl">
            <h1>רשימת מורשים</h1>
            <p>
              {counts.all} אנשים
              {updatedAt ? ` · עודכן ${formatUpdatedAt(updatedAt)}` : ''}
              {isDemoMode() ? ' · מצב הדגמה מקומי' : ''}
            </p>
          </div>
        </div>
        <div className="top-actions" dir="rtl">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={loading || busy || photoBusy}
            onClick={() => void refresh()}
          >
            {loading ? 'טוען…' : 'רענון'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy || photoBusy}
            onClick={() => photoInputRef.current?.click()}
          >
            {photoBusy
              ? `קורא תמונה… ${photoProgress}%`
              : '📷 הוספה מתמונה'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || photoBusy}
            onClick={openAdd}
          >
            + הוספה
          </button>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => void onPhotoSelected(e.target.files?.[0])}
          />
        </div>
      </header>

      {error ? (
        <div className="banner error" role="alert">
          {error}
          <button type="button" className="btn btn-ghost" onClick={() => void refresh()}>
            נסו שוב
          </button>
        </div>
      ) : null}

      <div className="toolbar">
        <label className="search-field">
          <span className="sr-label">חיפוש</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש לפי שם או הערה…"
            autoComplete="off"
          />
        </label>
        <div className="filters" role="group" aria-label="סינון סוג">
          {(
            [
              ['all', 'הכל', counts.all],
              ['permanent', 'קבוע', counts.permanent],
              ['visitor', 'ויזיטור', counts.visitor],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              className={`chip ${kindFilter === key ? 'active' : ''}`}
              onClick={() => setKindFilter(key)}
            >
              {label} ({count})
            </button>
          ))}
        </div>
      </div>

      <main className="list-panel">
        {loading && people.length === 0 ? (
          <div className="empty">טוען את הרשימה…</div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            {people.length === 0
              ? 'אין עדיין אנשים ברשימה. לחצו על «הוספה».'
              : 'לא נמצאו תוצאות.'}
          </div>
        ) : (
          <ul className="people-list">
            {filtered.map((person, index) => (
              <li key={person.id} className="person-row">
                <div className="person-main">
                  <div className="person-name">
                    <span className="idx">{index + 1}.</span>
                    {displayName(person)}
                  </div>
                  <div className="person-meta">
                    <span className={`kind-badge ${person.kind}`}>
                      {kindLabel(person.kind)}
                    </span>
                    {person.expiresOn ? (
                      <span className="expires-badge timed">
                        עד {formatExpiresOnHe(person.expiresOn)}
                      </span>
                    ) : (
                      <span className="expires-badge unlimited">
                        ללא הגבלת זמן
                      </span>
                    )}
                    {person.notes ? (
                      <span className="notes" dir="auto">
                        {person.notes}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="person-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => openEdit(person)}
                  >
                    עריכה
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={busy}
                    onClick={() => void onDelete(person)}
                  >
                    מחיקה
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>

      {toast ? <div className="toast">{toast}</div> : null}

      {photoPreview ? (
        <div
          className="modal-backdrop"
          onClick={() => !busy && setPhotoPreview(null)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>
              הוספה מתמונה — {photoSplit.toAdd.length} חדשים
              {photoSplit.already.length > 0
                ? ` · ${photoSplit.already.length} כבר ברשימה`
                : ''}
            </h2>
            <p className="field-hint">
              Company = CHEVRON → קבוע · אחרת → ויזיטור. לכל אדם אפשר
              הערה ותאריך סיום שונים. שמות שכבר רשומים לא יתווספו שוב.
            </p>
            {photoSplit.toAdd.length > 0 ? (
              <ul className="photo-preview-list">
                {photoSplit.toAdd.map((p, index) => {
                  const key = personNameKey(p.firstName, p.lastName)
                  return (
                    <li key={`new:${key}`} className="photo-draft-row">
                      <div className="photo-draft-head">
                        <strong dir="auto">
                          {p.firstName} {p.lastName}
                        </strong>
                        <span className={`kind-badge ${p.kind}`}>
                          {kindLabel(p.kind)}
                        </span>
                        <span className="notes" dir="ltr">
                          {p.company}
                        </span>
                      </div>
                      <div className="photo-draft-fields">
                        <label className="field">
                          <span>הערה</span>
                          <input
                            type="text"
                            value={p.notes}
                            onChange={(e) =>
                              updatePhotoDraft(p, { notes: e.target.value })
                            }
                            placeholder="אופציונלי…"
                            dir="auto"
                            disabled={busy}
                            aria-label={`הערה ל-${p.firstName} ${p.lastName}`}
                          />
                        </label>
                        <ExpiresOnPicker
                          id={`photo-expires-${index}`}
                          label="תאריך סיום / יציאה"
                          hint=""
                          value={p.expiresOn}
                          disabled={busy}
                          onChange={(expiresOn) =>
                            updatePhotoDraft(p, { expiresOn })
                          }
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="field-hint">כל השמות מהתמונה כבר ברשימה.</p>
            )}
            {photoSplit.already.length > 0 ? (
              <div className="photo-skipped">
                <p className="field-hint">דולגו (כבר רשומים):</p>
                <ul className="photo-preview-list photo-preview-skipped">
                  {photoSplit.already.map((p) => (
                    <li key={`old:${p.lastName}|${p.firstName}`}>
                      <strong dir="auto">
                        {p.firstName} {p.lastName}
                      </strong>
                      <span className="notes">כבר ברשימה</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => setPhotoPreview(null)}
              >
                ביטול
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || photoSplit.toAdd.length === 0}
                onClick={() => void confirmPhotoImport()}
              >
                {busy
                  ? 'מוסיף…'
                  : `הוסף חדשים (${photoSplit.toAdd.length})`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showForm ? (
        <div
          className="modal-backdrop"
          onClick={() => !busy && setShowForm(false)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{draft.id ? 'עריכת רשומה' : 'הוספת רשומה'}</h2>
            <form onSubmit={(e) => void submitForm(e)}>
              <div className="field">
                <label htmlFor="fn">שם פרטי</label>
                <input
                  id="fn"
                  value={draft.firstName}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, firstName: e.target.value }))
                  }
                  autoFocus
                  autoComplete="off"
                  dir="auto"
                />
              </div>
              <div className="field">
                <label htmlFor="ln">שם משפחה</label>
                <input
                  id="ln"
                  value={draft.lastName}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, lastName: e.target.value }))
                  }
                  autoComplete="off"
                  dir="auto"
                />
              </div>
              <div className="field">
                <span className="label">סוג</span>
                <div className="type-toggle">
                  <button
                    type="button"
                    className={`type-btn ${draft.kind === 'permanent' ? 'active' : ''}`}
                    onClick={() =>
                      setDraft((d) => ({ ...d, kind: 'permanent' }))
                    }
                  >
                    קבוע
                  </button>
                  <button
                    type="button"
                    className={`type-btn ${draft.kind === 'visitor' ? 'active' : ''}`}
                    onClick={() =>
                      setDraft((d) => ({ ...d, kind: 'visitor' }))
                    }
                  >
                    ויזיטור
                  </button>
                </div>
              </div>
              <ExpiresOnPicker
                id="expiresOn"
                label="תאריך סיום (אופציונלי)"
                hint="מורשה עד סוף היום הזה. ריק = ללא תפוגה."
                value={draft.expiresOn}
                disabled={busy}
                onChange={(expiresOn) =>
                  setDraft((d) => ({ ...d, expiresOn }))
                }
              />
              <div className="field">
                <label htmlFor="notes">הערות</label>
                <textarea
                  id="notes"
                  rows={3}
                  value={draft.notes}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, notes: e.target.value }))
                  }
                  dir="auto"
                />
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() => setShowForm(false)}
                >
                  ביטול
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busy}
                >
                  {busy ? 'שומר…' : 'שמירה'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}
