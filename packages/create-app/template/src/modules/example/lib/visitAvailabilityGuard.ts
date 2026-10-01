import type { CommandInterceptor, CommandInterceptorBeforeResult, CommandInterceptorContext } from '@open-mercato/shared/lib/commands/command-interceptor'
import { isOrganizationAccessAllowed } from '@open-mercato/shared/lib/auth/organizationAccess'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { getEnabledModuleIds, hasEnabledModulesRegistry } from '@open-mercato/shared/security/enabledModulesRegistry'
import type { CalendarEventTypeBehavior } from '@open-mercato/core/modules/customers/calendar-event-types'
import { evaluateVisitAvailability, resolveVisitService, visitAvailabilityInputSchema, type VisitAvailabilitySubject } from './visitAvailability'

type Row = Record<string, unknown>

function typeKey(value: unknown): string | null {
  return typeof value === 'string' ? value.trim().toLowerCase() : null
}

function get(row: Row, camel: string, snake: string): unknown {
  return row[camel] ?? row[snake]
}

function userIds(participants: unknown): string[] {
  if (!Array.isArray(participants)) return []
  return [...new Set(participants.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const participant = item as Row
    return participant.isCustomer !== true && participant.status !== 'customer' && typeof participant.userId === 'string' ? [participant.userId] : []
  }))]
}

function resourceIds(links: unknown): string[] {
  if (!Array.isArray(links)) return []
  return [...new Set(links.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const link = item as Row
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
      ? userIds(args.participants)
      : [],
    resourceIds: args.behavior.fields.resources && args.enabledModules.has('resources') && args.enabledModules.has('planner')
      ? resourceIds(args.links)
      : [],
  }
}

async function resolveVisitBehavior(context: CommandInterceptorContext, tenantId: string, organizationId: string): Promise<CalendarEventTypeBehavior | null> {
  const service = resolveVisitService<{ resolveBehavior: (input: { tenantId: string; organizationId: string; key: string }) => Promise<CalendarEventTypeBehavior | null> }>(context.container, 'calendarEventTypeCatalogService')
  if (!service) throw new Error('visit_availability_catalog_unavailable')
  return service.resolveBehavior({ tenantId, organizationId, key: 'visit' })
}

function blocked(reasonKey: string, status = 422, fields: string[] = [], subjects?: VisitAvailabilitySubject[]): CommandInterceptorBeforeResult {
  return {
    ok: false,
    status,
    body: {
      error: reasonKey,
      code: 'visit_availability_unavailable',
      ...(subjects ? { subjects } : {}),
      fieldErrors: Object.fromEntries(fields.map((field) => [field, reasonKey])),
    },
  }
}

function hasAvailabilityChange(input: Row): boolean {
  return ['interactionType', 'interaction_type', 'scheduledAt', 'scheduled_at', 'durationMinutes', 'duration_minutes',
    'participants', 'linkedEntities', 'linked_entities', 'allDay', 'all_day', 'recurrenceRule', 'recurrence_rule', 'status']
    .some((field) => field in input)
}

function changedAvailability(input: Row, existing: Row): boolean {
  const scalarFields = [['scheduledAt', 'scheduled_at'], ['durationMinutes', 'duration_minutes'], ['allDay', 'all_day'], ['recurrenceRule', 'recurrence_rule']]
  const changedScalar = scalarFields.some(([camel, snake]) => {
    if (!(camel in input) && !(snake in input)) return false
    const incoming = get(input, camel, snake)
    const saved = get(existing, camel, snake)
    if (camel === 'scheduledAt') return new Date(incoming as string).getTime() !== new Date(saved as string).getTime()
    return (incoming ?? (camel === 'allDay' ? false : null)) !== (saved ?? (camel === 'allDay' ? false : null))
  })
  const equalIds = (left: string[], right: string[]) => left.length === right.length && left.every((id) => right.includes(id))
  return changedScalar
    || ('status' in input && existing.status === 'canceled' && input.status !== 'canceled')
    || ('participants' in input && !equalIds(userIds(input.participants), userIds(existing.participants)))
    || (('linkedEntities' in input || 'linked_entities' in input) && !equalIds(resourceIds(get(input, 'linkedEntities', 'linked_entities')), resourceIds(get(existing, 'linkedEntities', 'linked_entities'))))
}

async function beforeVisitWrite(rawInput: unknown, context: CommandInterceptorContext): Promise<CommandInterceptorBeforeResult> {
  if (!rawInput || typeof rawInput !== 'object') return { ok: true }
  const input = rawInput as Row
  const suppliedType = typeKey(get(input, 'interactionType', 'interaction_type'))
  if (suppliedType !== null && suppliedType !== 'visit') return { ok: true }
  const updating = context.commandId === 'customers.interactions.update'
  if (!updating && suppliedType !== 'visit') return { ok: true }
  if (updating && !hasAvailabilityChange(input)) return { ok: true }
  const tenantId = context.auth?.tenantId
  const organizationScope = context.organizationScope
  const interactionFields = ['id', 'organization_id', 'interaction_type', 'status', 'scheduled_at', 'duration_minutes', 'participants', 'linked_entities', 'all_day', 'recurrence_rule', 'updated_at']
  let preflightExisting: Row | null = null
  if (organizationScope && tenantId && organizationScope.tenantId !== tenantId) {
    return blocked('example.calendar.visitAvailability.missingScope', 403)
  }
  if (updating && suppliedType === null && tenantId) {
    try {
      const engine = resolveVisitService<QueryEngine>(context.container, 'queryEngine')
      const recordId = input.id
      if (!engine || typeof recordId !== 'string') return { ok: true }
      const result = await engine.query<Row>('customers:customer_interaction', {
        tenantId,
        filters: { id: recordId, deleted_at: null },
        fields: interactionFields,
        page: { page: 1, pageSize: 1 },
      })
      preflightExisting = result.items[0] ?? null
      if (typeKey(get(preflightExisting ?? {}, 'interactionType', 'interaction_type')) !== 'visit') return { ok: true }
    } catch {
      return blocked('example.calendar.visitAvailability.retry', 503)
    }
  }
  const fallbackOrganizationId = context.selectedOrganizationId ?? context.auth?.orgId ?? null
  const allowedIds = organizationScope ? organizationScope.allowedIds : fallbackOrganizationId ? [fallbackOrganizationId] : []
  if (!tenantId || organizationScope?.selectionRejected || (organizationScope && organizationScope.tenantId !== tenantId)) {
    return blocked('example.calendar.visitAvailability.missingScope', 403)
  }
  if (!context.auth?.isSuperAdmin && Array.isArray(allowedIds) && !allowedIds.length) return blocked('example.calendar.visitAvailability.missingScope', 403)
  let existing: Row = {}
  let organizationId: string
  try {
    let record = preflightExisting
    if (!record) {
      const engine = resolveVisitService<QueryEngine>(context.container, 'queryEngine')
      if (!engine) return blocked('example.calendar.visitAvailability.retry', 503)
      const recordId = updating ? input.id : input.entityId
      if (typeof recordId !== 'string') return blocked('example.calendar.visitAvailability.missingScope', 422)
      const result = await engine.query<Row>(updating ? 'customers:customer_interaction' : 'customers:customer_entity', {
        tenantId,
        ...(allowedIds === null || context.auth?.isSuperAdmin ? {} : { organizationIds: allowedIds }),
        filters: { id: recordId, deleted_at: null },
        fields: updating ? interactionFields : ['id', 'organization_id'],
        page: { page: 1, pageSize: 1 },
      })
      record = result.items[0] ?? null
    }
    if (!record) return blocked('example.calendar.visitAvailability.missingScope', 404)
    const recordOrganizationId = get(record, 'organizationId', 'organization_id')
    if (typeof recordOrganizationId !== 'string' || !isOrganizationAccessAllowed({
      isSuperAdmin: context.auth?.isSuperAdmin === true, allowedOrganizationIds: allowedIds, targetOrganizationId: recordOrganizationId,
    })) return blocked('example.calendar.visitAvailability.missingScope', 403)
    organizationId = recordOrganizationId
    if (updating) existing = record
  } catch {
    return blocked('example.calendar.visitAvailability.retry', 503)
  }
  const interactionType = suppliedType ?? typeKey(get(existing, 'interactionType', 'interaction_type'))
  if (interactionType !== 'visit') return { ok: true }
  if (updating && typeKey(get(existing, 'interactionType', 'interaction_type')) === 'visit' && !changedAvailability(input, existing)) return { ok: true }
  if (updating && typeof input.id === 'string') {
    await enforceCommandOptimisticLockWithGuards(context.container, {
      resourceKind: 'customers.interaction',
      resourceId: input.id,
      current: get(existing, 'updatedAt', 'updated_at') as string | Date | null | undefined,
      request: context.request ?? null,
    })
  }
  let behavior: CalendarEventTypeBehavior | null
  try {
    behavior = await resolveVisitBehavior(context, tenantId, organizationId)
  } catch {
    return blocked('example.calendar.visitAvailability.retry', 503)
  }
  if (!behavior) return { ok: true }
  const scheduledAt = 'scheduledAt' in input || 'scheduled_at' in input ? get(input, 'scheduledAt', 'scheduled_at') : get(existing, 'scheduledAt', 'scheduled_at')
  const durationMinutes = 'durationMinutes' in input || 'duration_minutes' in input ? get(input, 'durationMinutes', 'duration_minutes') : get(existing, 'durationMinutes', 'duration_minutes')
  const allDay = 'allDay' in input || 'all_day' in input ? get(input, 'allDay', 'all_day') : get(existing, 'allDay', 'all_day')
  const recurrenceRule = 'recurrenceRule' in input || 'recurrence_rule' in input ? get(input, 'recurrenceRule', 'recurrence_rule') : get(existing, 'recurrenceRule', 'recurrence_rule')
  const participants = input.participants === undefined ? get(existing, 'participants', 'participants') : input.participants
  const links = 'linkedEntities' in input || 'linked_entities' in input ? get(input, 'linkedEntities', 'linked_entities') : get(existing, 'linkedEntities', 'linked_entities')
  const selected = selectVisitSubjectsForSave({
    behavior,
    enabledModules: new Set(hasEnabledModulesRegistry() ? getEnabledModuleIds() : ['staff', 'resources', 'planner']),
    participants,
    links,
  })
  const start = scheduledAt instanceof Date ? scheduledAt : new Date(typeof scheduledAt === 'string' ? scheduledAt : '')
  if (Number.isNaN(start.getTime()) || typeof durationMinutes !== 'number' || !Number.isInteger(durationMinutes) || durationMinutes <= 0 || allDay === true || recurrenceRule) {
    return blocked('example.calendar.visitAvailability.invalidInterval', 422, ['scheduledAt', 'durationMinutes'])
  }
  const parsed = visitAvailabilityInputSchema.safeParse({
    startAt: start.toISOString(),
    endAt: new Date(start.getTime() + durationMinutes * 60000).toISOString(),
    staffUserIds: selected.staffUserIds,
    resourceIds: selected.resourceIds,
    ...(existing?.id ? { excludeInteractionId: existing.id } : {}),
  })
  if (!parsed.success) return blocked('example.calendar.visitAvailability.invalidInterval', 422, ['scheduledAt', 'durationMinutes'])
  const selectedCount = parsed.data.staffUserIds.length + parsed.data.resourceIds.length
  if (!selectedCount) return { ok: true }
  const actorUserId = context.auth?.sub
  if (!actorUserId) return blocked('example.calendar.visitAvailability.retry', 503)
  const results = await evaluateVisitAvailability({
    container: context.container,
    actorUserId,
    scope: { tenantId, organizationId },
    input: parsed.data,
  })
  const failure = results.find((subject) => subject.status === 'unknown') ?? results.find((subject) => subject.status === 'unavailable')
  if (failure) return blocked(
    failure.reasonKey ?? 'example.calendar.visitAvailability.retry',
    failure.reasonKey === 'example.calendar.visitAvailability.missingScope' ? 403 : failure.status === 'unknown' ? 503 : 422,
    [...new Set(results.filter((subject) => subject.status !== 'available').map((subject) => subject.type === 'staff' ? 'participants' : 'linkedEntities'))],
    results.filter((subject) => subject.status !== 'available'),
  )
  return { ok: true }
}

export const visitAvailabilityInterceptors: CommandInterceptor[] = [
  { id: 'example.visit-availability-create', targetCommand: 'customers.interactions.create', priority: 40, beforeExecute: beforeVisitWrite },
  { id: 'example.visit-availability-update', targetCommand: 'customers.interactions.update', priority: 40, beforeExecute: beforeVisitWrite },
]
