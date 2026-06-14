import type { CalendarItem, CalendarItemStatus, CalendarParticipant } from '../../components/calendar/types'
import type { ConflictScope } from './preferences'

export const EDITOR_DRAFT_CONFLICT_ID = '__draft__'

export type FindConflictsOptions = {
  // 'all' (default) flags any actor-sharing overlap; 'mine' only flags overlaps
  // where `currentUserId` is an actor of BOTH events (the user is double-booked).
  // 'mine' with no `currentUserId` degrades to 'all' — it cannot resolve "mine".
  scope?: ConflictScope
  currentUserId?: string | null
}

function sharesActor(first: CalendarItem, second: CalendarItem): boolean {
  if (first.ownerUserId && second.ownerUserId && first.ownerUserId === second.ownerUserId) return true
  if (first.participants.length === 0 || second.participants.length === 0) return false
  const firstParticipantIds = new Set(first.participants.map((participant) => participant.userId))
  return second.participants.some((participant) => firstParticipantIds.has(participant.userId))
}

function isActor(item: CalendarItem, userId: string): boolean {
  if (item.ownerUserId === userId) return true
  return item.participants.some((participant) => participant.userId === userId)
}

function appendConflict(conflicts: Map<string, string[]>, itemId: string, otherId: string): void {
  const existing = conflicts.get(itemId)
  if (existing) existing.push(otherId)
  else conflicts.set(itemId, [otherId])
}

export function findConflicts(items: CalendarItem[], options: FindConflictsOptions = {}): Map<string, string[]> {
  const conflicts = new Map<string, string[]>()
  const restrictToCurrentUser = options.scope === 'mine' && Boolean(options.currentUserId)
  const currentUserId = options.currentUserId ?? ''
  const candidates = items
    .filter((item) => item.status !== 'canceled')
    .sort((first, second) => first.start.getTime() - second.start.getTime())

  for (let index = 0; index < candidates.length; index += 1) {
    const current = candidates[index]
    const currentEnd = current.end.getTime()
    for (let lookahead = index + 1; lookahead < candidates.length; lookahead += 1) {
      const other = candidates[lookahead]
      if (other.start.getTime() >= currentEnd) break
      if (current.start.getTime() >= other.end.getTime()) continue
      // Org-wide rule first: the two events must share at least one actor.
      if (!sharesActor(current, other)) continue
      // 'mine' narrows that set to the current user's OWN double-bookings — they
      // must be an actor of both events. Because they are then the shared actor,
      // 'mine' is always a strict subset of 'all' (it never invents new conflicts).
      if (restrictToCurrentUser && !(isActor(current, currentUserId) && isActor(other, currentUserId))) continue
      appendConflict(conflicts, current.id, other.id)
      appendConflict(conflicts, other.id, current.id)
    }
  }
  return conflicts
}

export type EditorConflictDraft = {
  start: Date
  end: Date
  ownerUserId: string | null
  participants: CalendarParticipant[]
  // The edited record's status. A canceled draft is excluded by `findConflicts`
  // exactly as the grid excludes canceled items, so the editor never warns about
  // a record the grid would not badge/ring. Defaults to 'planned'.
  status?: CalendarItemStatus
}

/**
 * Resolves the items a calendar editor draft conflicts with, using the SAME
 * `findConflicts` rules as the grid (overlap + shared owner/participant) so the
 * editor's conflict warning is always consistent with the grid badges/rings.
 * The edited record itself (`excludeId`) is never treated as a conflict.
 */
export function findEditorConflictItems(
  draft: EditorConflictDraft,
  others: CalendarItem[],
  excludeId: string | null,
  options: FindConflictsOptions = {},
): CalendarItem[] {
  const draftStatus: CalendarItemStatus = draft.status ?? 'planned'
  const draftItem: CalendarItem = {
    id: EDITOR_DRAFT_CONFLICT_ID,
    title: '',
    interactionType: 'meeting',
    category: 'other',
    status: draftStatus,
    start: draft.start,
    end: draft.end,
    allDay: false,
    location: null,
    platform: null,
    locationKind: null,
    participants: draft.participants,
    ownerUserId: draft.ownerUserId,
    entityId: null,
    dealId: null,
    color: null,
    isRecurringOccurrence: false,
    updatedAt: null,
    raw: { id: EDITOR_DRAFT_CONFLICT_ID, interactionType: 'meeting', status: draftStatus },
  }
  // Exclude the edited record by its underlying interaction id (`raw.id`), which
  // also drops every expanded occurrence of an edited recurring series (those
  // share the series `raw.id` but get distinct display ids) so it never conflicts
  // with itself.
  const candidates = others.filter(
    (item) => item.id !== EDITOR_DRAFT_CONFLICT_ID && item.raw.id !== excludeId,
  )
  const conflictIds = findConflicts([draftItem, ...candidates], options).get(EDITOR_DRAFT_CONFLICT_ID) ?? []
  const byId = new Map(candidates.map((item) => [item.id, item]))
  return conflictIds
    .map((id) => byId.get(id))
    .filter((item): item is CalendarItem => Boolean(item))
}
