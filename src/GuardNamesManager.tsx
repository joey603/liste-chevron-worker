import { useState } from 'react'

export default function GuardNamesManager({
  names,
  onChange,
}: {
  names: string[]
  onChange: (names: string[]) => void
}) {
  const [draft, setDraft] = useState('')

  function addName() {
    const trimmed = draft.trim()
    if (!trimmed) return
    if (names.some((n) => n === trimmed)) {
      setDraft('')
      return
    }
    onChange([...names, trimmed].sort((a, b) => a.localeCompare(b, 'he')))
    setDraft('')
  }

  function removeName(name: string) {
    onChange(names.filter((n) => n !== name))
  }

  return (
    <div className="shift-guard-names-manage">
      <span className="shift-guard-names-label">שמות מאבטחים לרשימה</span>
      <div className="shift-guard-names-add">
        <input
          type="text"
          value={draft}
          placeholder="הוסף שם מאבטח…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addName()
            }
          }}
        />
        <button
          type="button"
          className="btn btn-ghost shift-guard-names-add-btn"
          onClick={addName}
        >
          +
        </button>
      </div>
      {names.length > 0 ? (
        <div className="shift-guard-names-list">
          {names.map((name) => (
            <span key={name} className="shift-guard-name-tag">
              {name}
              <button
                type="button"
                className="shift-guard-name-remove"
                aria-label={`הסר ${name}`}
                onClick={() => removeName(name)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="shift-guard-names-hint">אין שמות עדיין — הוסיפו למעלה</p>
      )}
    </div>
  )
}
