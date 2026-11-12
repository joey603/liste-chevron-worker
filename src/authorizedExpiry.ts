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
