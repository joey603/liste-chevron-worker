/** Ligne rich-text (HTML léger autorisé dans <li>) */
export type ShiftRichHtml = string

const REMINDER_STYLE =
  'color:#ff0000;font-weight:700;text-decoration:underline'
const FAULT_STYLE =
  'color:#ff0000;font-weight:700;text-decoration:underline'

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Décode les entités HTML (&quot;, &amp;quot;, …) jusqu’au texte réel. */
export function decodeHtmlEntities(text: string): string {
  if (typeof document !== 'undefined') {
    let current = text
    for (let i = 0; i < 4; i++) {
      const ta = document.createElement('textarea')
      ta.innerHTML = current
      const next = ta.value
      if (next === current) return next
      current = next
    }
    return current
  }
  let current = text
  for (let i = 0; i < 4; i++) {
    const next = current
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&amp;/gi, '&')
    if (next === current) return next
    current = next
  }
  return current
}

export function stripHtml(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  ).trim()
}

/** Convertit une couleur CSS (#hex, rgb, rgba, nom) → hex 6 chars sans # */
export function cssColorToHex(input?: string | null): string | undefined {
  if (!input) return undefined
  const raw = input.trim().toLowerCase()
  if (!raw || raw === 'transparent' || raw === 'inherit' || raw === 'initial')
    return undefined

  if (raw.startsWith('#')) {
    const h = raw.slice(1)
    if (/^[0-9a-f]{3}$/i.test(h)) {
      return h
        .split('')
        .map((c) => c + c)
        .join('')
        .toUpperCase()
    }
    if (/^[0-9a-f]{6}$/i.test(h)) return h.toUpperCase()
    if (/^[0-9a-f]{8}$/i.test(h)) return h.slice(0, 6).toUpperCase()
    return undefined
  }

  const rgbMatch = raw.match(
    /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)/,
  )
  if (rgbMatch) {
    const toHex = (n: string) =>
      Math.max(0, Math.min(255, Math.round(Number(n))))
        .toString(16)
        .padStart(2, '0')
    return `${toHex(rgbMatch[1])}${toHex(rgbMatch[2])}${toHex(rgbMatch[3])}`.toUpperCase()
  }

  const named: Record<string, string> = {
    black: '000000',
    white: 'FFFFFF',
    red: 'FF0000',
    blue: '0000FF',
    green: '008000',
    yellow: 'FFFF00',
    orange: 'FFA500',
    gray: '808080',
    grey: '808080',
    cyan: '00FFFF',
    magenta: 'FF00FF',
  }
  if (named[raw]) return named[raw]

  if (/^[0-9a-f]{6}$/i.test(raw)) return raw.toUpperCase()
  return undefined
}

export function plainToRichHtml(
  text: string,
  style?: string,
): ShiftRichHtml {
  const clean = text.trim()
  if (!clean) return ''
  const body = escapeHtml(clean)
  if (!style) return body
  return `<span style="${style}">${body}</span>`
}

export function normalizeRichLine(raw: unknown, fallbackStyle?: string): string {
  if (typeof raw !== 'string') return ''
  const trimmed = raw.trim()
  if (!trimmed) return ''

  // Déjà du HTML (balises) → sanitize sans ré-échapper
  if (/<\/?[a-z][\s\S]*>/i.test(trimmed)) {
    return typeof document !== 'undefined'
      ? sanitizeRichHtml(trimmed)
      : trimmed
  }

  // Entités HTML (&quot; / &amp;quot; …) → décoder puis échapper une seule fois
  if (/&(?:#x?[\da-f]+|[a-z]+);/i.test(trimmed)) {
    return plainToRichHtml(decodeHtmlEntities(trimmed), fallbackStyle)
  }

  return plainToRichHtml(trimmed, fallbackStyle)
}

export function normalizeRichLines(
  raw: unknown,
  fallbackStyle?: string,
  defaults?: string[],
): string[] {
  if (!Array.isArray(raw)) {
    return (defaults ?? []).map((line) =>
      plainToRichHtml(line, fallbackStyle),
    )
  }
  const lines = raw
    .map((item) => normalizeRichLine(item, fallbackStyle))
    .filter(Boolean)
  return lines.length > 0
    ? lines
    : (defaults ?? []).map((line) => normalizeRichLine(line, fallbackStyle))
}

const STYLE_PROPS = new Set([
  'color',
  'background-color',
  'background',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-decoration',
  'text-transform',
])

/** Autorise uniquement des balises / styles sûrs pour l’édition */
export function sanitizeRichHtml(html: string): string {
  if (typeof document === 'undefined') return html
  const template = document.createElement('template')
  template.innerHTML = html
  const walk = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      const tag = el.tagName.toLowerCase()
      const allowed = new Set([
        'span',
        'b',
        'strong',
        'i',
        'em',
        'u',
        'br',
        'font',
        'mark',
      ])
      if (!allowed.has(tag)) {
        const parent = el.parentNode
        if (parent) {
          const moved: Node[] = []
          while (el.firstChild) {
            const child = el.firstChild
            parent.insertBefore(child, el)
            moved.push(child)
          }
          parent.removeChild(el)
          moved.forEach(walk)
        }
        return
      }
      const style = el.getAttribute('style') || ''
      const keep: string[] = []
      for (const part of style.split(';')) {
        const [prop, ...rest] = part.split(':')
        if (!prop || rest.length === 0) continue
        const key = prop.trim().toLowerCase()
        let val = rest.join(':').trim()
        if (!STYLE_PROPS.has(key)) continue
        // Normalise background → background-color
        if (key === 'background') {
          if (/gradient|url\(/i.test(val)) continue
          const hex = cssColorToHex(val.split(/\s+/)[0])
          if (hex) keep.push(`background-color:#${hex}`)
          continue
        }
        if (key === 'color' || key === 'background-color') {
          const hex = cssColorToHex(val)
          if (hex) val = `#${hex}`
          else if (val !== 'transparent') continue
        }
        if (key === 'text-transform') {
          const t = val.toLowerCase()
          if (
            t !== 'uppercase' &&
            t !== 'lowercase' &&
            t !== 'capitalize' &&
            t !== 'none'
          ) {
            continue
          }
          val = t
        }
        keep.push(`${key}:${val}`)
      }
      if (tag === 'mark' && !keep.some((k) => k.startsWith('background-color'))) {
        keep.push('background-color:#FFFF00')
      }
      ;[...el.attributes].forEach((attr) => {
        if (attr.name === 'style') return
        if (
          tag === 'font' &&
          (attr.name === 'color' || attr.name === 'face' || attr.name === 'size')
        )
          return
        el.removeAttribute(attr.name)
      })
      if (keep.length) el.setAttribute('style', keep.join(';'))
      else el.removeAttribute('style')
    }
    ;[...node.childNodes].forEach(walk)
  }
  ;[...template.content.childNodes].forEach(walk)
  return template.innerHTML
}

export function richLinesToEditableHtml(lines: string[]): string {
  if (lines.length === 0) return '<ul><li><br></li></ul>'
  return `<ul>${lines.map((line) => `<li>${line || '<br>'}</li>`).join('')}</ul>`
}

export function editableHtmlToRichLines(html: string): string[] {
  const root = document.createElement('div')
  root.innerHTML = html
  const items = root.querySelectorAll('li')
  if (items.length > 0) {
    return [...items]
      .map((li) =>
        sanitizeRichHtml(li.innerHTML.replace(/^[\s\u2022\-\*]+/, '').trim()),
      )
      .map((s) => s.replace(/^(<br\s*\/?>)+$/i, ''))
      .filter((s) => stripHtml(s).length > 0 || /<img|<br/i.test(s))
  }
  const text = stripHtml(html)
  return text
    .split('\n')
    .map((l) => l.replace(/^[\s\u2022\-\*]+/, '').trim())
    .filter(Boolean)
    .map((l) => escapeHtml(l))
}

export function richHtmlToPlain(html: string): string {
  return stripHtml(html)
}

type RunStyle = {
  bold?: boolean
  italics?: boolean
  underline?: boolean
  color?: string
  highlight?: string
  font?: string
  size?: number
}

/** Parse HTML riche → segments pour export Word (docx TextRun). */
export function parseRichHtmlSegments(html: string): Array<{
  text: string
  style: RunStyle
}> {
  if (typeof document === 'undefined') {
    const t = stripHtml(html)
    return t ? [{ text: t, style: {} }] : []
  }
  const root = document.createElement('div')
  root.innerHTML = sanitizeRichHtml(html)
  const out: Array<{ text: string; style: RunStyle }> = []

  function mergeStyle(base: RunStyle, el: HTMLElement): RunStyle {
    const next = { ...base }
    const tag = el.tagName.toLowerCase()
    if (tag === 'b' || tag === 'strong') next.bold = true
    if (tag === 'i' || tag === 'em') next.italics = true
    if (tag === 'u') next.underline = true
    if (tag === 'mark') next.highlight = next.highlight ?? '#FFFF00'
    if (tag === 'font') {
      const face = el.getAttribute('face')
      const color = el.getAttribute('color')
      if (face) next.font = face
      const hex = cssColorToHex(color)
      if (hex) next.color = hex
    }
    const style = el.getAttribute('style') || ''
    for (const part of style.split(';')) {
      const [prop, ...rest] = part.split(':')
      if (!prop || rest.length === 0) continue
      const key = prop.trim().toLowerCase()
      const val = rest.join(':').trim()
      if (key === 'color') {
        const hex = cssColorToHex(val)
        if (hex) next.color = hex
      }
      if (
        (key === 'background-color' || key === 'background') &&
        val &&
        val !== 'transparent'
      ) {
        const hex = cssColorToHex(val.split(/\s+/)[0])
        if (hex) next.highlight = `#${hex}`
      }
      if (key === 'font-family')
        next.font = val.replace(/['"]/g, '').split(',')[0]?.trim()
      if (key === 'font-weight' && (val === 'bold' || Number(val) >= 600))
        next.bold = true
      if (key === 'font-style' && val === 'italic') next.italics = true
      if (key === 'text-decoration' && val.includes('underline'))
        next.underline = true
      if (key === 'text-transform' && val.toLowerCase() === 'uppercase') {
        // Appliqué au moment de l’export via le texte déjà transformé si besoin
      }
      if (key === 'font-size') {
        const n = Number.parseFloat(val)
        if (Number.isFinite(n)) {
          next.size = val.includes('px')
            ? Math.round(n * 0.75 * 2)
            : Math.round(n * 2)
        }
      }
    }
    return next
  }

  function walk(node: Node, style: RunStyle) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ''
      if (text) out.push({ text, style: { ...style } })
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as HTMLElement
    const tag = el.tagName.toLowerCase()
    if (tag === 'br') {
      out.push({ text: '\n', style: { ...style } })
      return
    }
    const next = mergeStyle(style, el)
    ;[...el.childNodes].forEach((child) => walk(child, next))
  }

  ;[...root.childNodes].forEach((child) => walk(child, {}))
  return out
}

export const SHIFT_RICH_DEFAULT_REMINDER_STYLE = REMINDER_STYLE
export const SHIFT_RICH_DEFAULT_FAULT_STYLE = FAULT_STYLE

export const SHIFT_FONT_OPTIONS = [
  'Arial',
  'David',
  'Times New Roman',
  'Courier New',
  'Georgia',
] as const

export const SHIFT_TEXT_COLORS = [
  { label: 'שחור', value: '#000000' },
  { label: 'אדום', value: '#ff0000' },
  { label: 'כחול', value: '#0057a8' },
  { label: 'ירוק', value: '#15803d' },
  { label: 'אפור', value: '#666666' },
] as const

export const SHIFT_HIGHLIGHT_COLORS = [
  { label: 'ללא', value: 'transparent' },
  { label: 'צהוב', value: '#ffff00' },
  { label: 'ירוק בהיר', value: '#ccff99' },
  { label: 'תכלת', value: '#99ffff' },
  { label: 'ורוד', value: '#ff99cc' },
  { label: 'כתום', value: '#ffcc99' },
] as const
