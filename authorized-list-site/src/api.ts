import {
  isExpired,
  normalizeExpiresOn,
  type AuthorizedPerson,
} from './types'

const API_URL = (import.meta.env.VITE_API_URL || '').trim()
/** Démo locale seulement en `npm run dev` sans API — jamais en production. */
const DEMO_MODE = Boolean(import.meta.env.DEV) && !API_URL

export type ApiResult =
  | {
      ok: true
      people: AuthorizedPerson[]
      person?: AuthorizedPerson
      updatedAt?: string
      expiredRemoved?: number
    }
  | { ok: false; error: string }

let demoPeople: AuthorizedPerson[] = [
  {
    id: 'row:2',
    firstName: 'יוסי',
    lastName: 'כהן',
    kind: 'permanent',
    notes: 'דוגמה — מצב מקומי',
    expiresOn: '',
  },
  {
    id: 'row:3',
    firstName: 'Sara',
    lastName: 'Levy',
    kind: 'visitor',
    notes: 'Demo visitor',
    expiresOn: '2020-01-01',
  },
]
let demoNextRow = 4

function purgeDemoExpired(): number {
  const before = demoPeople.length
  demoPeople = demoPeople.filter((p) => !isExpired(p.expiresOn))
  return before - demoPeople.length
}

function demoResult(
  person?: AuthorizedPerson,
  expiredRemoved = 0,
): ApiResult {
  return {
    ok: true,
    people: [...demoPeople],
    person,
    updatedAt: new Date().toISOString(),
    expiredRemoved,
  }
}

async function post(
  secret: string,
  body: Record<string, unknown>,
): Promise<ApiResult> {
  if (DEMO_MODE) {
    const action = String(body.action || 'list')
    if (action === 'list') {
      const expiredRemoved = purgeDemoExpired()
      return demoResult(undefined, expiredRemoved)
    }
    if (action === 'upsert') {
      const person = (body.person || {}) as Partial<AuthorizedPerson>
      const firstName = String(person.firstName || '').trim()
      const lastName = String(person.lastName || '').trim()
      const kind = person.kind === 'visitor' ? 'visitor' : 'permanent'
      const notes = String(person.notes || '').trim()
      const expiresOn = normalizeExpiresOn(person.expiresOn)
      const id = String(person.id || '').trim()
      if (id) {
        const idx = demoPeople.findIndex((p) => p.id === id)
        if (idx >= 0) {
          const saved: AuthorizedPerson = {
            id,
            firstName,
            lastName,
            kind,
            notes,
            expiresOn,
          }
          demoPeople = demoPeople.map((p, i) => (i === idx ? saved : p))
          return demoResult(saved)
        }
      }
      const saved: AuthorizedPerson = {
        id: `row:${demoNextRow++}`,
        firstName,
        lastName,
        kind,
        notes,
        expiresOn,
      }
      demoPeople = [...demoPeople, saved]
      return demoResult(saved)
    }
    if (action === 'delete') {
      const id = String(body.id || '').trim()
      const before = demoPeople.length
      demoPeople = demoPeople.filter((p) => p.id !== id)
      if (demoPeople.length === before) return { ok: false, error: 'not_found' }
      return demoResult()
    }
    return { ok: false, error: 'unknown_action' }
  }

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret, ...body }),
      redirect: 'follow',
    })
    const data = (await res.json().catch(() => null)) as ApiResult | null
    if (!data || typeof data !== 'object') {
      return { ok: false, error: 'api_failed' }
    }
    return data
  } catch {
    return { ok: false, error: 'offline' }
  }
}

export function isDemoMode() {
  return DEMO_MODE
}

export function listPeople(secret: string) {
  return post(secret, { action: 'list' })
}

export function upsertPerson(
  secret: string,
  person: Partial<AuthorizedPerson> & {
    firstName: string
    lastName: string
    kind: AuthorizedPerson['kind']
  },
) {
  return post(secret, { action: 'upsert', person })
}

export function deletePerson(secret: string, id: string) {
  return post(secret, { action: 'delete', id })
}

export function apiErrorMessage(error?: string): string {
  switch (error) {
    case 'unauthorized':
      return 'הקישור אינו תקין או שפג תוקפו'
    case 'relay_not_configured':
    case 'api_not_configured':
      return 'השרת עדיין לא הוגדר (VITE_API_URL / ACCESS_SECRET)'
    case 'offline':
      return 'אין חיבור לרשת'
    case 'not_found':
      return 'הרשומה לא נמצאה'
    default:
      return error ? `שגיאה: ${error}` : 'הפעולה נכשלה'
  }
}
