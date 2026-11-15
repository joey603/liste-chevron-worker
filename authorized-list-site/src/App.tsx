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
  const [photoPreview, setPhotoPreview] = useState<ParsedRosterPerson[] | null>(
    null,
  )
  const [photoNotes, setPhotoNotes] = useState('')
  const [photoExpiresOn, setPhotoExpiresOn] = useState('')

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
    return [...people]
      .filter((p) => (kindFilter === 'all' ? true : p.kind === kindFilter))
      .filter((p) => {
        if (!q) return true
        const hay = `${p.firstName} ${p.lastName} ${p.notes}`.toLowerCase()
        return hay.includes(q)
      })
      .sort((a, b) =>
        displayName(a).localeCompare(displayName(b), 'he'),
      )
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
    setPhotoNotes('')
    setPhotoExpiresOn('')
    setError(null)
    try {
      const parsed = await parseRosterImage(file, (ratio) =>
        setPhotoProgress(Math.round(ratio * 100)),
      )
      if (parsed.length === 0) {
        setToast('לא זוהו שמות בתמונה — נסו צילום ברור יותר של הטבלה')
        return
      }
      setPhotoPreview(parsed)
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
      return { toAdd: [] as ParsedRosterPerson[], already: [] as ParsedRosterPerson[] }
    }
    const existing = new Set(
      people.map((p) => personNameKey(p.firstName, p.lastName)),
    )
    const toAdd: ParsedRosterPerson[] = []
    const already: ParsedRosterPerson[] = []
    for (const person of photoPreview) {
      const key = personNameKey(person.firstName, person.lastName)
      if (existing.has(key)) already.push(person)
      else toAdd.push(person)
    }
    return { toAdd, already }
  }, [photoPreview, people])

  async function confirmPhotoImport() {
    if (!secret || photoSplit.toAdd.length === 0) return
    setBusy(true)
    let added = 0
    let lastPeople = people
    let lastUpdated = updatedAt
    const comment = photoNotes.trim()
    const expiresOn = photoExpiresOn.trim()
    for (const person of photoSplit.toAdd) {
      const companyNote = person.company ? `Company: ${person.company}` : ''
      const notes = [comment, companyNote].filter(Boolean).join(' · ')
      const result = await upsertPerson(secret, {
        firstName: person.firstName,
        lastName: person.lastName,
        kind: person.kind,
        notes,
        expiresOn,
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
    setPhotoNotes('')
    setPhotoExpiresOn('')
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
            capture="environment"
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
                      <span className="expires-badge">
                        עד {formatExpiresOnHe(person.expiresOn)}
                      </span>
                    ) : null}
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
              Company = CHEVRON → קבוע · אחרת → ויזיטור. שמות שכבר רשומים
              לא יתווספו שוב.
            </p>
            <div className="field">
              <label htmlFor="photoNotes">הערה / תגובה (לכולם)</label>
              <textarea
                id="photoNotes"
                rows={2}
                value={photoNotes}
                onChange={(e) => setPhotoNotes(e.target.value)}
                placeholder="אופציונלי…"
                dir="auto"
                disabled={busy}
              />
            </div>
            <div className="field">
              <label htmlFor="photoExpiresOn">תאריך סיום / יציאה</label>
              <input
                id="photoExpiresOn"
                type="date"
                value={photoExpiresOn}
                onChange={(e) => setPhotoExpiresOn(e.target.value)}
                dir="ltr"
                disabled={busy}
              />
              <p className="field-hint">
                חל על כל השמות החדשים. ריק = ללא תפוגה.
              </p>
            </div>
            {photoSplit.toAdd.length > 0 ? (
              <ul className="photo-preview-list">
                {photoSplit.toAdd.map((p) => (
                  <li key={`new:${p.lastName}|${p.firstName}`}>
                    <strong dir="auto">
                      {p.firstName} {p.lastName}
                    </strong>
                    <span className={`kind-badge ${p.kind}`}>
                      {kindLabel(p.kind)}
                    </span>
                    <span className="notes" dir="ltr">
                      {p.company}
                    </span>
                  </li>
                ))}
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
                onClick={() => {
                  setPhotoPreview(null)
                  setPhotoNotes('')
                  setPhotoExpiresOn('')
                }}
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
              <div className="field">
                <label htmlFor="expiresOn">תאריך סיום (אופציונלי)</label>
                <input
                  id="expiresOn"
                  type="date"
                  value={draft.expiresOn}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, expiresOn: e.target.value }))
                  }
                  dir="ltr"
                />
                <p className="field-hint">
                  מורשה עד סוף היום הזה. ריק = ללא תפוגה.
                </p>
              </div>
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
