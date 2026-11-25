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

/** Empreinte du contenu seulement (pas updatedAt) — évite de resynchroniser à chaque touch Sheet. */
export function authorizedListFingerprint(
  people: AuthorizedPerson[],
  _updatedAt?: string,
): string {
  return people
    .map(
      (p) =>
        `${p.id}|${p.firstName.trim().toLowerCase()}|${p.lastName.trim().toLowerCase()}|${p.kind}|${p.expiresOn ?? ''}|${p.notes}`,
    )
    .sort()
    .join(';')
}

type ApiMutationResult =
  | {
      ok: true
      people: AuthorizedPerson[]
      person?: AuthorizedPerson | null
      updatedAt?: string
    }
  | { ok: false; error: string }

function parsePeopleResponse(
  data: {
    ok?: boolean
    error?: string
    people?: ApiPerson[]
    person?: ApiPerson | null
    updatedAt?: string
    expiredRemoved?: number
  } | null,
): ApiListResult | ApiMutationResult {
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
  const person = data.person ? mapPerson(data.person, syncedAt) : null

  return {
    ok: true,
    people,
    person,
    updatedAt: syncedAt,
    expiredRemoved:
      typeof data.expiredRemoved === 'number' ? data.expiredRemoved : 0,
  }
}

async function postAuthorizedListApi(
  apiUrl: string,
  secret: string,
  body: Record<string, unknown>,
): Promise<ApiListResult | ApiMutationResult> {
  const url = apiUrl.trim()
  const key = secret.trim()
  if (!url || !key) {
    return { ok: false, error: 'api_not_configured' }
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret: key, ...body }),
      redirect: 'follow',
    })
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean
      error?: string
      people?: ApiPerson[]
      person?: ApiPerson | null
      updatedAt?: string
      expiredRemoved?: number
    } | null
    return parsePeopleResponse(data)
  } catch {
    return { ok: false, error: 'offline' }
  }
}

/** Lecture de la רשימת מורשים via Apps Script (même source que le site). */
export async function fetchAuthorizedListFromApi(
  apiUrl: string,
  secret: string,
): Promise<ApiListResult> {
  const result = await postAuthorizedListApi(apiUrl, secret, { action: 'list' })
  if (!result.ok) return result
  return {
    ok: true,
    people: result.people,
    updatedAt: result.updatedAt,
    expiredRemoved:
      'expiredRemoved' in result && typeof result.expiredRemoved === 'number'
        ? result.expiredRemoved
        : 0,
  }
}

/** Met à jour / crée une personne (kind עובד/ויזיטור) dans la Sheet synchronisée. */
export async function upsertAuthorizedPersonToApi(
  apiUrl: string,
  secret: string,
  person: {
    id?: string
    firstName: string
    lastName: string
    kind: 'permanent' | 'visitor'
    notes?: string
    expiresOn?: string
  },
): Promise<ApiMutationResult> {
  return postAuthorizedListApi(apiUrl, secret, {
    action: 'upsert',
    person: {
      id: person.id?.trim() || undefined,
      firstName: person.firstName.trim(),
      lastName: person.lastName.trim(),
      kind: person.kind,
      notes: person.notes?.trim() ?? '',
      expiresOn: person.expiresOn?.trim() ?? '',
    },
  })
}
