import type { CommandInterceptor, CommandInterceptorBeforeResult, CommandInterceptorContext } from '@open-mercato/shared/lib/commands/command-interceptor'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { getEnabledModuleIds, hasEnabledModulesRegistry } from '@open-mercato/shared/security/enabledModulesRegistry'
import type { CalendarEventTypeBehavior } from '@open-mercato/core/modules/customers/calendar-event-types'
import { evaluateVisitAvailability, resolveVisitService, visitAvailabilityInputSchema } from './visitAvailability'

type Row = Record<string, unknown>

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

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id))
}

export function selectVisitSubjectsForSave(args: {
  behavior: CalendarEventTypeBehavior
  enabledModules: ReadonlySet<string>
  sameType: boolean
  savedParticipants: unknown
  savedLinks: unknown
  participants: unknown
  links: unknown
}): { staffUserIds: string[]; resourceIds: string[]; unavailableField: 'participants' | 'linkedEntities' | null } {
  const savedStaffIds = userIds(args.savedParticipants)
  const savedResourceIds = resourceIds(args.savedLinks)
  const selectedStaffIds = userIds(args.participants)
  const selectedResourceIds = resourceIds(args.links)
  let unavailableField: 'participants' | 'linkedEntities' | null = null
  let staffUserIds: string[] = []
  let resourceIdsForCheck: string[] = []

  if (args.behavior.fields.people !== 'none') {
    if (args.enabledModules.has('staff') && args.enabledModules.has('planner')) {
      staffUserIds = selectedStaffIds
    } else if (selectedStaffIds.length && !(args.sameType && sameIds(savedStaffIds, selectedStaffIds))) {
      unavailableField = 'participants'
    }
  }
  if (args.behavior.fields.resources) {
    if (args.enabledModules.has('resources') && args.enabledModules.has('planner')) {
      resourceIdsForCheck = selectedResourceIds
    } else if (selectedResourceIds.length && !(args.sameType && sameIds(savedResourceIds, selectedResourceIds))) {
      unavailableField ??= 'linkedEntities'
    }
  }
  return { staffUserIds, resourceIds: resourceIdsForCheck, unavailableField }
}

async function resolveVisitBehavior(context: CommandInterceptorContext, tenantId: string, organizationId: string): Promise<CalendarEventTypeBehavior | null> {
  const service = resolveVisitService<{ resolveBehavior: (input: { tenantId: string; organizationId: string; key: string }) => Promise<CalendarEventTypeBehavior | null> }>(context.container, 'calendarEventTypeCatalogService')
  if (!service) throw new Error('visit_availability_catalog_unavailable')
  return service.resolveBehavior({ tenantId, organizationId, key: 'visit' })
}

function blocked(reasonKey: string, status = 422, fields: string[] = []): CommandInterceptorBeforeResult {
  return {
    ok: false,
    status,
    body: {
      error: reasonKey,
      code: 'visit_availability_unavailable',
      fields,
      fieldErrors: Object.fromEntries(fields.map((field) => [field, reasonKey])),
    },
  }
}

async function beforeVisitWrite(rawInput: unknown, context: CommandInterceptorContext): Promise<CommandInterceptorBeforeResult> {
  if (!rawInput || typeof rawInput !== 'object') return blocked('example.calendar.visitAvailability.invalidInterval')
  const input = rawInput as Row
  const tenantId = context.auth?.tenantId
  const organizationId = context.selectedOrganizationId
  if (!tenantId || !organizationId) return blocked('example.calendar.visitAvailability.missingScope', 403)
  let existing: Row = {}
  if (context.commandId === 'customers.interactions.update') {
    if (typeof input.id !== 'string') return blocked('example.calendar.visitAvailability.retry', 503)
    try {
      const engine = resolveVisitService<QueryEngine>(context.container, 'queryEngine')
      if (!engine) return blocked('example.calendar.visitAvailability.retry', 503)
      const result = await engine.query<Row>('customers:customer_interaction', {
        tenantId, organizationId, filters: { id: input.id },
        fields: ['id', 'interaction_type', 'scheduled_at', 'duration_minutes', 'participants', 'linked_entities', 'all_day', 'recurrence_rule', 'updated_at'],
        page: { page: 1, pageSize: 1 },
      })
      if (!result.items.length) return { ok: true }
      existing = result.items[0]
    } catch {
      return blocked('example.calendar.visitAvailability.retry', 503)
    }
  }
  const interactionType = get(input, 'interactionType', 'interaction_type') ?? get(existing, 'interactionType', 'interaction_type')
  if (interactionType !== 'visit') return { ok: true }
  if (context.commandId === 'customers.interactions.update' && typeof input.id === 'string') {
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
  const links = input.linkedEntities === undefined ? get(existing, 'linkedEntities', 'linked_entities') : input.linkedEntities
  const selected = selectVisitSubjectsForSave({
    behavior,
    enabledModules: new Set(hasEnabledModulesRegistry() ? getEnabledModuleIds() : []),
    sameType: get(existing, 'interactionType', 'interaction_type') === 'visit',
    savedParticipants: get(existing, 'participants', 'participants'),
    savedLinks: get(existing, 'linkedEntities', 'linked_entities'),
    participants,
    links,
  })
  if (selected.unavailableField) return blocked('example.calendar.visitAvailability.retry', 503, [selected.unavailableField])
  const start = scheduledAt instanceof Date ? scheduledAt : new Date(typeof scheduledAt === 'string' ? scheduledAt : '')
  if (Number.isNaN(start.getTime()) || typeof durationMinutes !== 'number' || !Number.isInteger(durationMinutes) || durationMinutes <= 0 || allDay === true || recurrenceRule) {
    return blocked('example.calendar.visitAvailability.invalidInterval', 422, ['scheduledAt', 'durationMinutes'])
  }
  const parsed = visitAvailabilityInputSchema.safeParse({
    startAt: start.toISOString(),
    endAt: new Date(start.getTime() + durationMinutes * 60000).toISOString(),
    staffUserIds: selected.staffUserIds,
    resourceIds: selected.resourceIds,
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
  const failure = results.find((subject) => subject.status !== 'available')
  if (failure) return blocked(
    failure.reasonKey ?? 'example.calendar.visitAvailability.retry',
    failure.status === 'unknown' ? 503 : 422,
    [failure.type === 'staff' ? 'participants' : 'linkedEntities'],
  )
  return { ok: true }
}

export const visitAvailabilityInterceptors: CommandInterceptor[] = [
  { id: 'example.visit-availability-create', targetCommand: 'customers.interactions.create', priority: 40, beforeExecute: beforeVisitWrite },
  { id: 'example.visit-availability-update', targetCommand: 'customers.interactions.update', priority: 40, beforeExecute: beforeVisitWrite },
]
