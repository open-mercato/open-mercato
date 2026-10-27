import type { AwilixContainer } from 'awilix'
import { getEnabledModuleIds, hasEnabledModulesRegistry } from '@open-mercato/shared/security/enabledModulesRegistry'
import type { CalendarEventTypeBehavior } from '@open-mercato/core/modules/customers/calendar-event-types'
import { resolveVisitService, visitAvailabilityInputSchema, type VisitAvailabilityInput } from './visitAvailability'

export type VisitRow = Record<string, unknown>

/**
 * Columns the pre-write guard and the transaction-bound re-check both need to
 * reach the same decision. Dropping one here makes the re-check silently skip
 * (issue: concurrent reschedules double-booking the same subject).
 */
export const VISIT_INTERACTION_FIELDS = [
  'id',
  'tenant_id',
  'organization_id',
  'interaction_type',
  'status',
  'scheduled_at',
  'duration_minutes',
  'participants',
  'linked_entities',
  'all_day',
  'recurrence_rule',
  'owner_user_id',
  'updated_at',
] as const

export const VISIT_TYPE_PROBE_FIELDS = ['id', 'organization_id', 'interaction_type'] as const

const AVAILABILITY_INPUT_FIELDS = [
  'interactionType', 'interaction_type',
  'scheduledAt', 'scheduled_at',
  'durationMinutes', 'duration_minutes',
  'participants',
  'linkedEntities', 'linked_entities',
  'allDay', 'all_day',
  'recurrenceRule', 'recurrence_rule',
  'status',
] as const

export class VisitAvailabilityDataError extends Error {}

export function visitTypeKey(value: unknown): string | null {
  return typeof value === 'string' ? value.trim().toLowerCase() : null
}

export function rowValue(row: VisitRow, camel: string, snake: string): unknown {
  return row[camel] ?? row[snake]
}

export function jsonArrayValue(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'string') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new VisitAvailabilityDataError('[internal] Visit availability payload is not valid JSON')
  }
  return Array.isArray(parsed) ? parsed : []
}

export function staffUserIds(participants: unknown, ownerUserId: unknown = null): string[] {
  const ids = jsonArrayValue(participants).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const participant = item as VisitRow
    return participant.isCustomer !== true && participant.status !== 'customer' && typeof participant.userId === 'string'
      ? [participant.userId]
      : []
  })
  if (typeof ownerUserId === 'string') ids.push(ownerUserId)
  return [...new Set(ids)]
}

export function resourceIds(links: unknown): string[] {
  return [...new Set(jsonArrayValue(links).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const link = item as VisitRow
    return link.type === 'resource' && typeof link.id === 'string' ? [link.id] : []
  }))]
}

export function selectVisitSubjectsForSave(args: {
  behavior: CalendarEventTypeBehavior
  enabledModules: ReadonlySet<string>
  participants: unknown
  links: unknown
}): { staffUserIds: string[]; resourceIds: string[] } {
  return {
    staffUserIds: args.behavior.fields.people !== 'none' && args.enabledModules.has('staff') && args.enabledModules.has('planner')
      ? staffUserIds(args.participants)
      : [],
    resourceIds: args.behavior.fields.resources && args.enabledModules.has('resources') && args.enabledModules.has('planner')
      ? resourceIds(args.links)
      : [],
  }
}

export function visitEnabledModules(): ReadonlySet<string> {
  return new Set(hasEnabledModulesRegistry() ? getEnabledModuleIds() : ['staff', 'resources', 'planner'])
}

export function hasAvailabilityChange(input: VisitRow): boolean {
  return AVAILABILITY_INPUT_FIELDS.some((field) => field in input)
}

export function changedAvailability(input: VisitRow, existing: VisitRow): boolean {
  const scalarFields: readonly [string, string][] = [
    ['scheduledAt', 'scheduled_at'],
    ['durationMinutes', 'duration_minutes'],
    ['allDay', 'all_day'],
    ['recurrenceRule', 'recurrence_rule'],
  ]
  const changedScalar = scalarFields.some(([camel, snake]) => {
    if (!(camel in input) && !(snake in input)) return false
    const incoming = rowValue(input, camel, snake)
    const saved = rowValue(existing, camel, snake)
    if (camel === 'scheduledAt') return new Date(incoming as string).getTime() !== new Date(saved as string).getTime()
    return (incoming ?? (camel === 'allDay' ? false : null)) !== (saved ?? (camel === 'allDay' ? false : null))
  })
  const equalIds = (left: string[], right: string[]) => left.length === right.length && left.every((id) => right.includes(id))
  return changedScalar
    || ('status' in input && existing.status === 'canceled' && input.status !== 'canceled')
    || ('participants' in input && !equalIds(staffUserIds(input.participants), staffUserIds(existing.participants)))
    || (('linkedEntities' in input || 'linked_entities' in input)
      && !equalIds(resourceIds(rowValue(input, 'linkedEntities', 'linked_entities')), resourceIds(rowValue(existing, 'linkedEntities', 'linked_entities'))))
}

export type VisitAvailabilityDecision =
  | { kind: 'skip' }
  | { kind: 'retry' }
  | { kind: 'invalidInterval' }
  | { kind: 'check'; input: VisitAvailabilityInput }

/**
 * First half of the shared decision: does this write touch Visit availability at
 * all? Behavior-free so callers can run it before taking any lock or resolving
 * the tenant's event-type catalog.
 */
export function requiresVisitAvailabilityCheck(args: {
  updating: boolean
  input: VisitRow
  existing: VisitRow | null
}): 'skip' | 'retry' | 'continue' {
  const { updating, input } = args
  const existing = args.existing ?? {}
  const suppliedType = visitTypeKey(rowValue(input, 'interactionType', 'interaction_type'))
  if (suppliedType !== null && suppliedType !== 'visit') return 'skip'
  if (!updating && suppliedType !== 'visit') return 'skip'
  if (updating && !hasAvailabilityChange(input)) return 'skip'
  const storedType = visitTypeKey(rowValue(existing, 'interactionType', 'interaction_type'))
  if ((suppliedType ?? storedType) !== 'visit') return 'skip'
  // A Visit that is, or is being left, canceled books nobody: canceled Visits are
  // never counted as conflicts, so moving one must not be refused for a clash.
  if (('status' in input ? input.status : existing.status) === 'canceled') return 'skip'
  try {
    if (updating && storedType === 'visit' && !changedAvailability(input, existing)) return 'skip'
  } catch (error) {
    if (error instanceof VisitAvailabilityDataError) return 'retry'
    throw error
  }
  return 'continue'
}

/**
 * Second half of the shared decision: the exact interval and subject set to
 * check, derived from the tenant's configured behavior. The pre-write guard and
 * the transaction-bound re-check both go through this so they can never disagree.
 */
export function buildVisitAvailabilityCheck(args: {
  input: VisitRow
  existing: VisitRow | null
  behavior: CalendarEventTypeBehavior | null
  enabledModules: ReadonlySet<string>
}): VisitAvailabilityDecision {
  const { input, behavior, enabledModules } = args
  const existing = args.existing ?? {}
  try {
    if (!behavior) return { kind: 'skip' }
    const scheduledAt = 'scheduledAt' in input || 'scheduled_at' in input
      ? rowValue(input, 'scheduledAt', 'scheduled_at')
      : rowValue(existing, 'scheduledAt', 'scheduled_at')
    const durationMinutes = 'durationMinutes' in input || 'duration_minutes' in input
      ? rowValue(input, 'durationMinutes', 'duration_minutes')
      : rowValue(existing, 'durationMinutes', 'duration_minutes')
    const allDay = 'allDay' in input || 'all_day' in input
      ? rowValue(input, 'allDay', 'all_day')
      : rowValue(existing, 'allDay', 'all_day')
    const recurrenceRule = 'recurrenceRule' in input || 'recurrence_rule' in input
      ? rowValue(input, 'recurrenceRule', 'recurrence_rule')
      : rowValue(existing, 'recurrenceRule', 'recurrence_rule')
    const participants = input.participants === undefined ? rowValue(existing, 'participants', 'participants') : input.participants
    const links = 'linkedEntities' in input || 'linked_entities' in input
      ? rowValue(input, 'linkedEntities', 'linked_entities')
      : rowValue(existing, 'linkedEntities', 'linked_entities')
    const selected = selectVisitSubjectsForSave({ behavior, enabledModules, participants, links })
    const start = scheduledAt instanceof Date ? scheduledAt : new Date(typeof scheduledAt === 'string' ? scheduledAt : '')
    if (Number.isNaN(start.getTime())
      || typeof durationMinutes !== 'number'
      || !Number.isInteger(durationMinutes)
      || durationMinutes <= 0
      || allDay === true
      || recurrenceRule) {
      return { kind: 'invalidInterval' }
    }
    const existingId = rowValue(existing, 'id', 'id')
    const parsed = visitAvailabilityInputSchema.safeParse({
      startAt: start.toISOString(),
      endAt: new Date(start.getTime() + durationMinutes * 60000).toISOString(),
      staffUserIds: selected.staffUserIds,
      resourceIds: selected.resourceIds,
      ...(typeof existingId === 'string' ? { excludeInteractionId: existingId } : {}),
    })
    if (!parsed.success) return { kind: 'invalidInterval' }
    if (!parsed.data.staffUserIds.length && !parsed.data.resourceIds.length) return { kind: 'skip' }
    return { kind: 'check', input: parsed.data }
  } catch (error) {
    if (error instanceof VisitAvailabilityDataError) return { kind: 'retry' }
    throw error
  }
}

export async function resolveVisitBehavior(
  container: Pick<AwilixContainer, 'resolve'>,
  tenantId: string,
  organizationId: string,
): Promise<CalendarEventTypeBehavior | null> {
  const service = resolveVisitService<{
    resolveBehavior: (input: { tenantId: string; organizationId: string; key: string }) => Promise<CalendarEventTypeBehavior | null>
  }>(container, 'calendarEventTypeCatalogService')
  if (!service) throw new Error('[internal] visit_availability_catalog_unavailable')
  return service.resolveBehavior({ tenantId, organizationId, key: 'visit' })
}
