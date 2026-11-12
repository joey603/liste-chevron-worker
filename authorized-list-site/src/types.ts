export type AuthorizedKind = 'permanent' | 'visitor'

export type AuthorizedPerson = {
  id: string
  firstName: string
  lastName: string
  kind: AuthorizedKind
  notes: string
  /** YYYY-MM-DD — מורשה עד סוף היום (ריק = ללא תפוגה) */
  expiresOn: string
}

export function displayName(p: AuthorizedPerson): string {
  return `${p.firstName} ${p.lastName}`.trim() || 'ללא שם'
}

export function kindLabel(kind: AuthorizedKind): string {
  return kind === 'visitor' ? 'ויזיטור' : 'קבוע'
}

export function localDateKey(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function normalizeExpiresOn(raw: unknown): string {
  if (raw == null || raw === '') return ''
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return localDateKey(raw)
  }
  const text = String(raw).trim()
  if (!text) return ''
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const he = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(text)
  if (he) {
    return `${he[3]}-${he[2].padStart(2, '0')}-${he[1].padStart(2, '0')}`
  }
  const parsed = new Date(text)
  if (!Number.isNaN(parsed.getTime())) return localDateKey(parsed)
  return ''
}

export function isExpired(expiresOn: string, now = new Date()): boolean {
  const day = normalizeExpiresOn(expiresOn)
  if (!day) return false
  return day < localDateKey(now)
}

export function formatExpiresOnHe(expiresOn: string): string {
  const day = normalizeExpiresOn(expiresOn)
  if (!day) return ''
  const [y, m, d] = day.split('-')
  return `${d}/${m}/${y}`
}
