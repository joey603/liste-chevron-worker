import { createId } from './types'

export type RosterHistoryAction = 'added' | 'removed'
export type RosterHistorySource = 'sync' | 'manual'
export type RosterHistoryKind = 'permanent' | 'visitor'

export type RosterHistoryEntry = {
  id: string
  action: RosterHistoryAction
  source: RosterHistorySource
  kind: RosterHistoryKind
  firstName: string
  lastName: string
  at: string
}

export const ROSTER_HISTORY_MAX = 500

export type RosterHistoryPerson = {
  firstName: string
  lastName: string
  kind: RosterHistoryKind
}

export function normalizeRosterHistory(raw: unknown): RosterHistoryEntry[] {
  if (!Array.isArray(raw)) return []
  const out: RosterHistoryEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Partial<RosterHistoryEntry>
    const firstName =
      typeof row.firstName === 'string' ? row.firstName.trim() : ''
    const lastName = typeof row.lastName === 'string' ? row.lastName.trim() : ''
    if (!firstName && !lastName) continue
    const action = row.action === 'added' || row.action === 'removed' ? row.action : null
    const source = row.source === 'sync' || row.source === 'manual' ? row.source : null
    const kind =
      row.kind === 'visitor' || row.kind === 'permanent' ? row.kind : null
    if (!action || !source || !kind) continue
    out.push({
      id: typeof row.id === 'string' && row.id.trim() ? row.id : createId(),
      action,
      source,
      kind,
      firstName,
      lastName,
      at:
        typeof row.at === 'string' && row.at.trim()
          ? row.at
          : new Date().toISOString(),
    })
    if (out.length >= ROSTER_HISTORY_MAX) break
  }
  return out
}

export function appendRosterHistory(
  history: RosterHistoryEntry[] | undefined,
  entries: Omit<RosterHistoryEntry, 'id' | 'at'>[],
  at = new Date().toISOString(),
): RosterHistoryEntry[] {
  if (entries.length === 0) return history ?? []
  const stamped: RosterHistoryEntry[] = entries.map((entry) => ({
    ...entry,
    id: createId(),
    at,
  }))
  return [...stamped, ...(history ?? [])].slice(0, ROSTER_HISTORY_MAX)
}

export function historyEntriesFromSync(payload: {
  added: RosterHistoryPerson[]
  removed: RosterHistoryPerson[]
}): Omit<RosterHistoryEntry, 'id' | 'at'>[] {
  return [
    ...payload.added.map((p) => ({
      action: 'added' as const,
      source: 'sync' as const,
      kind: p.kind,
      firstName: p.firstName,
      lastName: p.lastName,
    })),
    ...payload.removed.map((p) => ({
      action: 'removed' as const,
      source: 'sync' as const,
      kind: p.kind,
      firstName: p.firstName,
      lastName: p.lastName,
    })),
  ]
}

export function formatHistoryWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString('he-IL', {
      dateStyle: 'short',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

export function historyActionLabel(entry: RosterHistoryEntry): string {
  if (entry.action === 'added') {
    return entry.source === 'sync' ? 'נוסף מסנכרון' : 'נוסף ידנית'
  }
  return entry.source === 'sync' ? 'נמחק מסנכרון' : 'נמחק ידנית'
}

export function historyKindLabel(kind: RosterHistoryKind): string {
  return kind === 'visitor' ? 'ויזיטור' : 'קבוע'
}
