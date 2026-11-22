import { z } from 'zod'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ConflictScope } from './preferences'
import type { CalendarItem, CalendarRange } from '../../components/calendar/types'

const USER_BATCH_SIZE = 100
const MAX_RANGE_MS = 93 * 24 * 60 * 60_000
const MAX_PARALLEL_BATCHES = 4
const uuidSchema = z.string().uuid()

const responseSchema = z.object({
  items: z.array(z.object({
    userId: uuidSchema,
    organizationId: uuidSchema,
    windows: z.array(z.object({
      start: z.string().datetime().transform(Date.parse),
      end: z.string().datetime().transform(Date.parse),
      kind: z.enum(['unavailable', 'leave', 'tentative']),
      reason: z.string().optional(),
    })),
  })),
})

type StaffAvailabilityRow = z.infer<typeof responseSchema>['items'][number]
export type StaffAvailabilityWindow = StaffAvailabilityRow['windows'][number]
export type StaffAvailability = ReadonlyMap<string, readonly StaffAvailabilityWindow[]>
export const EMPTY_STAFF_AVAILABILITY: StaffAvailability = new Map()

type StaffPerson = { userId: string; label: string }
type StaffConflict = StaffPerson & Pick<StaffAvailabilityWindow, 'kind' | 'reason'>

function availabilityKey(organizationId: string, userId: string): string {
  return `${organizationId.toLowerCase()}:${userId.toLowerCase()}`
}

export function itemStaffPeople(item: CalendarItem): StaffPerson[] {
  const people = new Map<string, StaffPerson>()
  for (const participant of item.participants) {
    if (!participant.userId) continue
    const label = participant.name?.trim() || participant.email?.trim() || ''
    if (!people.get(participant.userId)?.label) people.set(participant.userId, { userId: participant.userId, label })
  }
  if (item.ownerUserId && !people.has(item.ownerUserId)) {
    const label = item.raw.authorUserId === item.ownerUserId && typeof item.raw.authorName === 'string'
      ? item.raw.authorName : ''
    people.set(item.ownerUserId, { userId: item.ownerUserId, label })
  }
  return [...people.values()]
}

export function calendarStaffAvailabilityCandidates(
  items: readonly CalendarItem[],
  scope: ConflictScope,
  currentUserId: string | null,
) {
  return items.flatMap((item) => {
    if (item.status === 'canceled' || typeof item.raw.organizationId !== 'string') return []
    const people = itemStaffPeople(item)
    if (!people.length || (scope === 'mine' && currentUserId && !people.some((person) => person.userId === currentUserId))) return []
    return [{ item, people, organizationId: item.raw.organizationId }]
  })
}

export function staffAvailabilityUserIds(userIds: readonly string[]): string[] {
  return [...new Set(userIds.filter((userId) => uuidSchema.safeParse(userId).success).map((userId) => userId.toLowerCase()))].sort()
}

export function getStaffAvailabilityWindows(
  availability: StaffAvailability,
  organizationId: string | null | undefined,
  userId: string,
): readonly StaffAvailabilityWindow[] | undefined {
  return organizationId ? availability.get(availabilityKey(organizationId, userId)) : undefined
}

export function findStaffAvailabilityConflicts(
  availability: StaffAvailability,
  range: CalendarRange,
  organizationId: string | null | undefined,
  people: readonly StaffPerson[],
): StaffConflict[] {
  const matches = new Map<string, StaffConflict>()
  const from = range.from.getTime()
  const to = range.to.getTime()
  for (const person of people) {
    for (const window of getStaffAvailabilityWindows(availability, organizationId, person.userId) ?? []) {
      if (window.start >= to || window.end <= from) continue
      const key = JSON.stringify([person.userId, window.kind, window.reason])
      const previous = matches.get(key)
      if (previous?.label) continue
      matches.set(key, { ...person, kind: window.kind, reason: window.reason })
    }
  }
  return [...matches.values()]
}

export function formatStaffAvailabilityConflict(conflict: StaffConflict, t: ReturnType<typeof useT>): string {
  const person = conflict.label || t('customers.calendar.availability.staffMember', 'Staff member')
  const label = {
    leave: () => t('customers.calendar.availability.personOnLeave', '{person} is on leave', { person }),
    tentative: () => t('customers.calendar.availability.personPendingLeave', '{person} has a pending leave request', { person }),
    unavailable: () => t('customers.calendar.availability.personUnavailable', '{person} is unavailable', { person }),
  }[conflict.kind]()
  return conflict.reason ? `${label} (${conflict.reason})` : label
}

async function loadBatch(
  userIds: string[],
  from: number,
  to: number,
  organizationId: string | null,
  signal: AbortSignal,
): Promise<Map<string, StaffAvailabilityWindow[]> | null> {
  let completeRows: Map<string, StaffAvailabilityWindow[]> | null = null
  for (let start = from; start < to; start += MAX_RANGE_MS) {
    if (signal.aborted) return null
    const params = new URLSearchParams({
      userIds: userIds.join(','),
      from: new Date(start).toISOString(),
      to: new Date(Math.min(start + MAX_RANGE_MS, to)).toISOString(),
    })
    if (organizationId) params.set('organizationId', organizationId)
    const response = await apiCall<unknown>(`/api/staff/availability/windows?${params}`, { signal })
    if (!response.ok) return null
    const parsed = responseSchema.safeParse(response.result)
    if (!parsed.success) return null
    const rows = new Map(parsed.data.items.map((row) => [availabilityKey(row.organizationId, row.userId), row.windows]))
    if (!completeRows) {
      completeRows = rows
      continue
    }
    for (const [key, current] of completeRows) {
      const next = rows.get(key)
      if (next) current.push(...next)
      else completeRows.delete(key)
    }
  }
  return completeRows
}

export async function loadStaffAvailability(
  userIds: string[],
  from: number,
  to: number,
  organizationId: string | null,
  signal: AbortSignal,
): Promise<StaffAvailability> {
  const batches: string[][] = []
  for (let offset = 0; offset < userIds.length; offset += USER_BATCH_SIZE) {
    batches.push(userIds.slice(offset, offset + USER_BATCH_SIZE))
  }
  const rows = new Map<string, StaffAvailabilityWindow[]>()
  for (let offset = 0; offset < batches.length && !signal.aborted; offset += MAX_PARALLEL_BATCHES) {
    const results = await Promise.allSettled(
      batches.slice(offset, offset + MAX_PARALLEL_BATCHES).map((batch) => loadBatch(batch, from, to, organizationId, signal)),
    )
    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value) continue
      for (const [key, windows] of result.value) rows.set(key, windows)
    }
  }
  return rows
}
