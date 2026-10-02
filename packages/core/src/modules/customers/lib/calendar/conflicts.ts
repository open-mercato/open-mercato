import type { CalendarItem, CalendarItemStatus, CalendarParticipant } from '../../components/calendar/types'
import { parseLinkedEntities } from './editorPayload'
import { participantActorKey } from './participantIdentity'
import type { ConflictScope } from './preferences'

export const EDITOR_DRAFT_CONFLICT_ID = '__draft__'

export type FindConflictsOptions = {
  // 'all' (default) flags any actor-sharing overlap; 'mine' only flags overlaps
  // where `currentUserId` is an actor of BOTH events (the user is double-booked).
  // 'mine' with no `currentUserId` degrades to 'all' — it cannot resolve "mine".
  scope?: ConflictScope
  currentUserId?: string | null
}

export type ConflictSubject = { kind: 'person' | 'resource'; key: string; label: string }

function participantLabel(participant: CalendarParticipant): string {
  return participant.name?.trim() || participant.email?.trim() || ''
}

function bookedResources(item: CalendarItem): Array<{ id: string; label: string }> {
  return parseLinkedEntities((item.raw as { linkedEntities?: unknown }).linkedEntities).resources
}

/**
 * The people and resources two events have in common — what makes an overlap a
 * double-booking. A person is shared through the owner or a participant; a
 * resource through a `resource` link. Labels are empty when the event carries no
 * name for the subject.
 */
export function sharedConflictSubjects(first: CalendarItem, second: CalendarItem): ConflictSubject[] {
  const shared = new Map<string, ConflictSubject>()
  const labelOf = (item: CalendarItem, actorKey: string): string => {
    const match = item.participants.find((participant) => participantActorKey(participant) === actorKey)
    return match ? participantLabel(match) : ''
  }
  if (first.ownerUserId && second.ownerUserId && first.ownerUserId === second.ownerUserId) {
    const key = `user:${first.ownerUserId}`
    shared.set(key, { kind: 'person', key, label: labelOf(first, key) || labelOf(second, key) })
  }
  if (first.participants.length > 0 && second.participants.length > 0) {
    const secondActorKeys = new Set(
      second.participants
        .map(participantActorKey)
        .filter((actorKey): actorKey is string => actorKey !== null),
    )
    for (const participant of first.participants) {
      const key = participantActorKey(participant)
      if (key === null || !secondActorKeys.has(key) || shared.has(key)) continue
      shared.set(key, { kind: 'person', key, label: participantLabel(participant) || labelOf(second, key) })
    }
  }
  const firstResources = bookedResources(first)
  if (firstResources.length > 0) {
    const secondResources = new Map(bookedResources(second).map((resource) => [resource.id, resource]))
    for (const resource of firstResources) {
      const other = secondResources.get(resource.id)
      if (!other) continue
      const key = `resource:${resource.id}`
      const label = resource.label !== resource.id ? resource.label : other.label !== other.id ? other.label : ''
      shared.set(key, { kind: 'resource', key, label })
    }
  }
  return [...shared.values()]
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
      // Org-wide rule first: the two events must share at least one actor or
      // booked resource.
      const shared = sharedConflictSubjects(current, other)
      if (shared.length === 0) continue
      // 'mine' narrows the people overlaps to the current user's OWN
      // double-bookings — they must be an actor of both events. Because they are
      // then the shared actor, 'mine' is always a strict subset of 'all' (it never
      // invents new conflicts). A double-booked resource is not anyone's in
      // particular — a room cannot host two events — so it is flagged in both scopes.
      if (
        restrictToCurrentUser
        && !shared.some((subject) => subject.kind === 'resource')
        && !(isActor(current, currentUserId) && isActor(other, currentUserId))
      ) continue
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
  // Resources the draft books. Omitted when the type has no resources field.
  resources?: Array<{ id: string; label: string }>
}

export type EditorConflict = { item: CalendarItem; shared: ConflictSubject[] }

/**
 * Resolves the items a calendar editor draft conflicts with, using the SAME
 * `findConflicts` rules as the grid (overlap + shared owner/participant/resource)
 * so the editor's conflict warning is always consistent with the grid
 * badges/rings. Each conflict names the people and resources that are
 * double-booked. The edited record itself (`excludeId`) is never treated as a
 * conflict.
 */
export function findEditorConflicts(
  draft: EditorConflictDraft,
  others: CalendarItem[],
  excludeId: string | null,
  options: FindConflictsOptions = {},
): EditorConflict[] {
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
    raw: {
      id: EDITOR_DRAFT_CONFLICT_ID,
      interactionType: 'meeting',
      status: draftStatus,
      linkedEntities: (draft.resources ?? []).map((resource) => ({ id: resource.id, type: 'resource', label: resource.label })),
    },
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
    .map((item) => ({ item, shared: sharedConflictSubjects(draftItem, item) }))
}

export function findEditorConflictItems(
  draft: EditorConflictDraft,
  others: CalendarItem[],
  excludeId: string | null,
  options: FindConflictsOptions = {},
): CalendarItem[] {
  return findEditorConflicts(draft, others, excludeId, options).map((conflict) => conflict.item)
}
