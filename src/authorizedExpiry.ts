/** Date d’autorisation (YYYY-MM-DD). Vide = pas d’expiration. */

export function localDateKey(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Normalise une valeur Excel / formulaire → YYYY-MM-DD ou ''. */
export function normalizeAuthorizedExpiresOn(raw: unknown): string {
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
    const d = he[1].padStart(2, '0')
    const m = he[2].padStart(2, '0')
    return `${he[3]}-${m}-${d}`
  }

  const parsed = new Date(text)
  if (!Number.isNaN(parsed.getTime())) return localDateKey(parsed)
  return ''
}

/** Valable jusqu’à la fin du jour `expiresOn` inclus. */
export function isAuthorizedExpired(
  expiresOn: string | null | undefined,
  now = new Date(),
): boolean {
  const day = normalizeAuthorizedExpiresOn(expiresOn)
  if (!day) return false
  return day < localDateKey(now)
}

export function formatAuthorizedExpiresOnHe(expiresOn: string): string {
  const day = normalizeAuthorizedExpiresOn(expiresOn)
  if (!day) return ''
  const [y, m, d] = day.split('-')
  return `${d}/${m}/${y}`
}

/** Aujourd’hui + N jours → YYYY-MM-DD (midi local). */
export function dateFromTodayPlusDays(days: number): string {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + days)
  return localDateKey(d)
}

/** Minuit juste après le jour expiresOn (fin de validité inclusive). */
export function endOfExpiresOnMidnight(expiresOn: string): string | null {
  const day = normalizeAuthorizedExpiresOn(expiresOn)
  if (!day) return null
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setHours(24, 0, 0, 0)
  return dt.toISOString()
}

/** Champs roster locaux dérivés d’une date Sheet (YYYY-MM-DD). */
export function applyRosterExpiresOn(expiresOn: string | null | undefined): {
  expiresOn: string
  temporary: boolean
  expiresAt: string | null
} {
  const day = normalizeAuthorizedExpiresOn(expiresOn)
  if (!day) return { expiresOn: '', temporary: false, expiresAt: null }
  return {
    expiresOn: day,
    temporary: true,
    expiresAt: endOfExpiresOnMidnight(day),
  }
}

/** Affichage / édition : expiresOn, sinon dérivé de temporary+expiresAt. */
export function rosterExpiresOnOf(person: {
  expiresOn?: string | null
  temporary?: boolean
  expiresAt?: string | null
}): string {
  const direct = normalizeAuthorizedExpiresOn(person.expiresOn)
  if (direct) return direct
  if (person.temporary && person.expiresAt) {
    const t = new Date(person.expiresAt)
    if (!Number.isNaN(t.getTime())) {
      return localDateKey(new Date(t.getTime() - 1))
    }
  }
  return ''
}
