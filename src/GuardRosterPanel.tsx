import { FormEvent, useMemo, useRef, useState } from 'react'
import { domToPng } from 'modern-screenshot'
import {
  contactDisplayName,
  createId,
  formatDateTime,
  guardDisplayName,
  normalizeWhatsAppPhone,
  type ContactPhone,
  type GuardRosterEntry,
} from './types'

const emptyGuard = {
  firstName: '',
  lastName: '',
  phone: '',
  address: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
}

type GuardForm = typeof emptyGuard

type Props = {
  guards: GuardRosterEntry[]
  onChange: (next: GuardRosterEntry[], message?: string) => void | Promise<void>
  onToast?: (message: string) => void
  toastMessage?: string | null
  /** מספרי WhatsApp לשליחה (אותם אנשי קשר מההגדרות — לא רשימת נוכחים) */
  shareContacts?: ContactPhone[]
  siteName?: string
}

export default function GuardRosterPanel({
  guards,
  onChange,
  onToast,
  toastMessage,
  shareContacts = [],
  siteName = 'אתר Chevron',
}: Props) {
  const [showAdd, setShowAdd] = useState(false)
  const [draft, setDraft] = useState<GuardForm>(emptyGuard)
  const [editing, setEditing] = useState<GuardRosterEntry | null>(null)
  const [showShare, setShowShare] = useState(false)
  const [sharePhoneDraft, setSharePhoneDraft] = useState('')
  const [sending, setSending] = useState(false)
  const captureRef = useRef<HTMLDivElement>(null)

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

  function openSharePicker() {
    if (guards.length === 0) {
      notify('אין שומרים ברוסטר לשליחה')
      return
    }
    setSharePhoneDraft(shareContacts[0]?.phone ?? '')
    setShowShare(true)
  }

  async function captureRosterImageDataUrl(): Promise<string | null> {
    const source = captureRef.current
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
    clone.style.width = `${Math.max(source.scrollWidth, source.clientWidth, 720)}px`
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
    clone.querySelectorAll<HTMLElement>('.banned-list, .roster-list').forEach((node) => {
      node.style.overflow = 'visible'
      node.style.maxHeight = 'none'
      node.style.height = 'auto'
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

  /** שליחת תמונת הרוסטר בלבד — לא רשימת נוכחים/עובדים */
  async function shareRosterOnWhatsAppToPhone(phoneRaw: string) {
    const phone = phoneRaw.trim()
    if (!normalizeWhatsAppPhone(phone)) {
      notify('מספר לא תקין')
      return
    }
    if (guards.length === 0) {
      notify('אין שומרים ברוסטר לשליחה')
      return
    }

    setShowShare(false)
    setSending(true)
    try {
      const dataUrl = await captureRosterImageDataUrl()
      if (!dataUrl) {
        notify('שגיאה ביצירת התמונה')
        return
      }

      if (window.listeApi?.sendWhatsAppText) {
        notify('שולח את התמונה ב־WhatsApp…')
        const result = await window.listeApi.sendWhatsAppText(
          phone,
          '',
          dataUrl,
        )
        const ok = typeof result === 'boolean' ? result : result.ok
        const error = typeof result === 'boolean' ? undefined : result.error
        if (!ok) {
          if (error === 'whatsapp_not_connected') {
            notify(
              'WhatsApp Web לא מחובר — לחצו על מצב החיבור וסרקו QR. התמונה הועתקה',
            )
            void window.listeApi.copyImage?.(dataUrl)
            void window.listeApi.openWhatsAppWebSession?.()
          } else if (error === 'offline') {
            notify('אין אינטרנט — לא ניתן לשלוח כרגע')
          } else {
            notify('שליחת התמונה נכשלה')
          }
          return
        }
        notify('התמונה נשלחה ב־WhatsApp')
        return
      }

      if (window.listeApi?.shareImageToWhatsApp) {
        const result = await window.listeApi.shareImageToWhatsApp(dataUrl)
        const ok = typeof result === 'boolean' ? result : result.ok
        notify(
          ok
            ? 'בחרו איש קשר ב־WhatsApp — התמונה תודבק'
            : 'שיתוף התמונה נכשל',
        )
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
      notify('התמונה הועתקה — הדביקו (Ctrl+V) ושלחו')
    } catch {
      notify('שגיאה בשליחת התמונה')
    } finally {
      setSending(false)
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
          <p>רשימת שומרים — פרטים ואיש קשר לחירום</p>
        </div>
        <div className="main-header-actions">
          <button
            type="button"
            className="btn btn-primary btn-whatsapp"
            style={{ width: 'auto' }}
            disabled={sending || sorted.length === 0}
            onClick={openSharePicker}
            title="שליחת רוסטר השומרים בלבד (לא רשימת נוכחים)"
          >
            שליחה ב־WhatsApp
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
                      {entry.address ? (
                        <span>כתובת: {entry.address}</span>
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

      {showShare ? (
        <div
          className="modal-backdrop"
          onClick={() => setShowShare(false)}
        >
          <div
            className="modal modal-share-target"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>שליחת הרשימה ב־WhatsApp</h3>
            <p className="settings-note" style={{ marginBottom: 12 }}>
              בחרו מספר — התמונה תישלח ישירות לצ׳אט (בלי בחירה בתוך WhatsApp).
            </p>

            {shareContacts.length > 0 ? (
              <div className="emergency-phone-scroll">
                <ul className="emergency-phone-list share-target-list">
                  {shareContacts.map((contact) => (
                    <li key={contact.id}>
                      <div className="contact-phone-meta">
                        <strong>{contactDisplayName(contact)}</strong>
                        <span dir="ltr">{contact.phone}</span>
                        {contact.emergency ? (
                          <span className="contact-phone-badge emergency">
                            חירום
                          </span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ width: 'auto' }}
                        disabled={sending}
                        onClick={() =>
                          void shareRosterOnWhatsAppToPhone(contact.phone)
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
                void shareRosterOnWhatsAppToPhone(sharePhoneDraft)
              }}
            >
              <div className="field">
                <label htmlFor="rosterSharePhone">מספר אחר</label>
                <input
                  id="rosterSharePhone"
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
                  onClick={() => setShowShare(false)}
                >
                  ביטול
                </button>
                <button
                  type="submit"
                  className="btn btn-primary btn-whatsapp"
                  style={{ width: 'auto' }}
                  disabled={
                    sending || !normalizeWhatsAppPhone(sharePhoneDraft)
                  }
                >
                  שלח תמונה
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  )
}
