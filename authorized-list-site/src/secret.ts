/** Extrait le secret depuis #/s/<secret> ou /s/<secret>/ */
export function readSecretFromLocation(
  loc: Location = window.location,
): string | null {
  const hash = loc.hash.replace(/^#/, '')
  const hashMatch = /^\/?s\/([^/?#]+)/.exec(hash)
  if (hashMatch?.[1]) return decodeURIComponent(hashMatch[1]).trim() || null

  const pathMatch = /\/s\/([^/?#]+)/.exec(loc.pathname)
  if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]).trim() || null

  const params = new URLSearchParams(loc.search)
  const q = params.get('s')?.trim()
  return q || null
}

export function buildSecretHash(secret: string): string {
  return `#/s/${encodeURIComponent(secret)}`
}
