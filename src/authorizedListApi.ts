import type { AuthorizedPerson } from './types'

type ApiPerson = {
  id?: string
  firstName?: string
  lastName?: string
  kind?: string
  notes?: string
  expiresOn?: string
}

type ApiListResult =
  | {
      ok: true
      people: AuthorizedPerson[]
      updatedAt?: string
      expiredRemoved?: number
    }
  | { ok: false; error: string }

function mapPerson(raw: ApiPerson, syncedAt: string): AuthorizedPerson | null {
  const firstName = String(raw.firstName || '').trim()
  const lastName = String(raw.lastName || '').trim()
  const notes = String(raw.notes || '').trim()
  const expiresOn = String(raw.expiresOn || '').trim()
  const id = String(raw.id || '').trim()
  if (!id && !firstName && !lastName) return null
  return {
    id: id || `${firstName}|${lastName}`,
    firstName,
    lastName,
    idNumber: '',
    kind: raw.kind === 'visitor' ? 'visitor' : 'permanent',
    notes,
    expiresOn,
    updatedAt: syncedAt,
  }
}

export function authorizedListFingerprint(
  people: AuthorizedPerson[],
  updatedAt?: string,
): string {
  if (updatedAt) return `at:${updatedAt}|n:${people.length}`
  return people
    .map(
      (p) =>
        `${p.id}|${p.firstName}|${p.lastName}|${p.kind}|${p.expiresOn ?? ''}|${p.notes}`,
    )
    .join(';')
}

/** Lecture de la רשימת מורשים via Apps Script (même source que le site). */
export async function fetchAuthorizedListFromApi(
  apiUrl: string,
  secret: string,
): Promise<ApiListResult> {
  const url = apiUrl.trim()
  const key = secret.trim()
  if (!url || !key) {
    return { ok: false, error: 'api_not_configured' }
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret: key, action: 'list' }),
      redirect: 'follow',
    })
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean
      error?: string
      people?: ApiPerson[]
      updatedAt?: string
      expiredRemoved?: number
    } | null

    if (!data || typeof data !== 'object') {
      return { ok: false, error: 'api_failed' }
    }
    if (!data.ok) {
      return { ok: false, error: String(data.error || 'api_failed') }
    }

    const syncedAt =
      typeof data.updatedAt === 'string' && data.updatedAt.trim()
        ? data.updatedAt.trim()
        : new Date().toISOString()
    const people = (Array.isArray(data.people) ? data.people : [])
      .map((p) => mapPerson(p, syncedAt))
      .filter((p): p is AuthorizedPerson => Boolean(p))

    return {
      ok: true,
      people,
      updatedAt: syncedAt,
      expiredRemoved:
        typeof data.expiredRemoved === 'number' ? data.expiredRemoved : 0,
    }
  } catch {
    return { ok: false, error: 'offline' }
  }
}
