import { useEffect, useRef, useState } from 'react'
import {
  SHIFT_FONT_OPTIONS,
  SHIFT_HIGHLIGHT_COLORS,
  SHIFT_TEXT_COLORS,
  editableHtmlToRichLines,
  richLinesToEditableHtml,
} from './shiftRichText'

type Props = {
  lines: string[]
  onChange: (lines: string[]) => void
  className?: string
  /** Classe CSS sur le <ul> éditable (ex: shift-reminders) */
  listClassName?: string
}

type ColorOption = { label: string; value: string }

function runCmd(command: string, value?: string) {
  document.execCommand('styleWithCSS', false, 'true')
  document.execCommand(command, false, value)
}

function ColorMenu({
  label,
  title,
  options,
  onPick,
}: {
  label: string
  title: string
  options: readonly ColorOption[]
  onPick: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div className="shift-rich-color-menu" ref={wrapRef}>
      <button
        type="button"
        className="shift-rich-btn shift-rich-color-trigger"
        title={title}
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open ? (
        <div className="shift-rich-color-dropdown" role="listbox" aria-label={title}>
          {options.map((c) => (
            <button
              key={c.value}
              type="button"
              role="option"
              className="shift-rich-color-option"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onPick(c.value)
                setOpen(false)
              }}
            >
              <span
                className={`shift-rich-swatch${
                  c.value === 'transparent' ? ' is-empty' : ''
                }`}
                style={
                  c.value === 'transparent'
                    ? undefined
                    : { background: c.value }
                }
                aria-hidden
              />
              <span>{c.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default function ShiftRichListEditor({
  lines,
  onChange,
  className = '',
  listClassName = '',
}: Props) {
  const editorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = editorRef.current
    if (!root) return
    root.innerHTML = richLinesToEditableHtml(lines)
    // Initialise uniquement au montage (remonter via key côté parent pour reset)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function emitFromDom() {
    const root = editorRef.current
    if (!root) return
    // Important : ne pas sanitizer le <ul>/<li> entier (sinon la liste est détruite
    // et le texte est ré-échappé → &quot; visible dans le preview).
    onChange(editableHtmlToRichLines(root.innerHTML))
  }

  function apply(command: string, value?: string) {
    editorRef.current?.focus()
    runCmd(command, value)
    emitFromDom()
  }

  function applyHighlight(value: string) {
    editorRef.current?.focus()
    document.execCommand('styleWithCSS', false, 'true')
    if (value === 'transparent') {
      const ok = document.execCommand('hiliteColor', false, 'transparent')
      if (!ok) document.execCommand('removeFormat', false)
    } else {
      const ok = document.execCommand('hiliteColor', false, value)
      if (!ok) document.execCommand('backColor', false, value)
    }
    emitFromDom()
  }

  function applyUppercase() {
    const root = editorRef.current
    if (!root) return
    root.focus()
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
    if (!root.contains(sel.anchorNode)) return
    const text = sel.toString()
    if (!text) return
    // Transforme vraiment le texte (preview + Word), pas seulement du CSS
    document.execCommand('insertText', false, text.toLocaleUpperCase('he-IL'))
    emitFromDom()
  }

  function addLine() {
    const root = editorRef.current
    if (!root) return

    let ul = root.querySelector('ul')
    if (!ul) {
      root.innerHTML = '<ul><li><br></li></ul>'
      ul = root.querySelector('ul')
    } else {
      const li = document.createElement('li')
      li.innerHTML = '<br>'
      ul.appendChild(li)
    }

    const lastLi = ul?.querySelector('li:last-child')
    if (lastLi) {
      root.focus()
      const range = document.createRange()
      range.selectNodeContents(lastLi)
      range.collapse(false)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }

    emitFromDom()
  }

  return (
    <div className={`shift-rich-editor ${className}`.trim()} dir="rtl">
      <div className="shift-rich-toolbar" role="toolbar" aria-label="עיצוב טקסט">
        <button
          type="button"
          className="shift-rich-btn"
          title="מודגש"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => apply('bold')}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          className="shift-rich-btn"
          title="נטוי"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => apply('italic')}
        >
          <em>I</em>
        </button>
        <button
          type="button"
          className="shift-rich-btn"
          title="קו תחתון"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => apply('underline')}
        >
          <span style={{ textDecoration: 'underline' }}>U</span>
        </button>
        <button
          type="button"
          className="shift-rich-btn"
          title="אותיות גדולות"
          onMouseDown={(e) => e.preventDefault()}
          onClick={applyUppercase}
        >
          AA
        </button>
        <span className="shift-rich-sep" />
        <ColorMenu
          label="צבע"
          title="צבע טקסט"
          options={SHIFT_TEXT_COLORS}
          onPick={(value) => apply('foreColor', value)}
        />
        <ColorMenu
          label="סמן"
          title="סמן רקע"
          options={SHIFT_HIGHLIGHT_COLORS}
          onPick={applyHighlight}
        />
        <label className="shift-rich-select-wrap">
          <span>גופן</span>
          <select
            defaultValue=""
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              if (!e.target.value) return
              apply('fontName', e.target.value)
              e.target.value = ''
            }}
          >
            <option value="" disabled>
              גופן
            </option>
            {SHIFT_FONT_OPTIONS.map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </select>
        </label>
        <span className="shift-rich-sep" />
        <button
          type="button"
          className="shift-rich-btn shift-rich-btn-add"
          title="הוסף שורה"
          onMouseDown={(e) => e.preventDefault()}
          onClick={addLine}
        >
          +
        </button>
        <button
          type="button"
          className="shift-rich-btn"
          title="רשימה עם נקודות"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => apply('insertUnorderedList')}
        >
          • רשימה
        </button>
      </div>
      <div
        ref={editorRef}
        className={`shift-rich-surface ${listClassName}`.trim()}
        contentEditable
        suppressContentEditableWarning
        onInput={emitFromDom}
        onBlur={emitFromDom}
      />
    </div>
  )
}
