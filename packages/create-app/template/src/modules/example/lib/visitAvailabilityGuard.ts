import type { CommandInterceptor, CommandInterceptorBeforeResult, CommandInterceptorContext } from '@open-mercato/shared/lib/commands/command-interceptor'
import { isOrganizationAccessAllowed } from '@open-mercato/shared/lib/auth/organizationAccess'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { CalendarEventTypeBehavior } from '@open-mercato/core/modules/customers/calendar-event-types'
import { evaluateVisitAvailability, resolveVisitService, type VisitAvailabilitySubject } from './visitAvailability'
import {
  VISIT_INTERACTION_FIELDS,
  buildVisitAvailabilityCheck,
  hasAvailabilityChange,
  requiresVisitAvailabilityCheck,
  resolveVisitBehavior,
  rowValue,
  visitEnabledModules,
  visitTypeKey,
  type VisitRow,
} from './visitAvailabilityDecision'

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

async function beforeVisitWrite(rawInput: unknown, context: CommandInterceptorContext): Promise<CommandInterceptorBeforeResult> {
  if (!rawInput || typeof rawInput !== 'object') return { ok: true }
  const input = rawInput as VisitRow
  const suppliedType = visitTypeKey(rowValue(input, 'interactionType', 'interaction_type'))
  if (suppliedType !== null && suppliedType !== 'visit') return { ok: true }
  const updating = context.commandId === 'customers.interactions.update'
  if (!updating && suppliedType !== 'visit') return { ok: true }
  if (updating && !hasAvailabilityChange(input)) return { ok: true }
  const tenantId = context.auth?.tenantId
  const organizationScope = context.organizationScope
  const interactionFields = [...VISIT_INTERACTION_FIELDS]
  let preflightExisting: VisitRow | null = null
  if (organizationScope && tenantId && organizationScope.tenantId !== tenantId) {
    return blocked('example.calendar.visitAvailability.missingScope', 403)
  }
  if (updating && suppliedType === null && tenantId) {
    try {
      const engine = resolveVisitService<QueryEngine>(context.container, 'queryEngine')
      const recordId = input.id
      if (!engine || typeof recordId !== 'string') return { ok: true }
      const result = await engine.query<VisitRow>('customers:customer_interaction', {
        tenantId,
        filters: { id: recordId, deleted_at: null },
        fields: interactionFields,
        page: { page: 1, pageSize: 1 },
      })
      preflightExisting = result.items[0] ?? null
      if (visitTypeKey(rowValue(preflightExisting ?? {}, 'interactionType', 'interaction_type')) !== 'visit') return { ok: true }
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
  let existing: VisitRow = {}
  let organizationId: string
  try {
    let record = preflightExisting
    if (!record) {
      const engine = resolveVisitService<QueryEngine>(context.container, 'queryEngine')
      if (!engine) return blocked('example.calendar.visitAvailability.retry', 503)
      const recordId = updating ? input.id : input.entityId
      if (typeof recordId !== 'string') return blocked('example.calendar.visitAvailability.missingScope', 422)
      const result = await engine.query<VisitRow>(updating ? 'customers:customer_interaction' : 'customers:customer_entity', {
        tenantId,
        ...(allowedIds === null || context.auth?.isSuperAdmin ? {} : { organizationIds: allowedIds }),
        filters: { id: recordId, deleted_at: null },
        fields: updating ? interactionFields : ['id', 'organization_id'],
        page: { page: 1, pageSize: 1 },
      })
      record = result.items[0] ?? null
    }
    if (!record) return blocked('example.calendar.visitAvailability.missingScope', 404)
    const recordOrganizationId = rowValue(record, 'organizationId', 'organization_id')
    if (typeof recordOrganizationId !== 'string' || !isOrganizationAccessAllowed({
      isSuperAdmin: context.auth?.isSuperAdmin === true, allowedOrganizationIds: allowedIds, targetOrganizationId: recordOrganizationId,
    })) return blocked('example.calendar.visitAvailability.missingScope', 403)
    organizationId = recordOrganizationId
    if (updating) existing = record
  } catch {
    return blocked('example.calendar.visitAvailability.retry', 503)
  }
  const required = requiresVisitAvailabilityCheck({ updating, input, existing: updating ? existing : null })
  if (required === 'skip') return { ok: true }
  if (required === 'retry') return blocked('example.calendar.visitAvailability.retry', 503)
  if (updating && typeof input.id === 'string') {
    await enforceCommandOptimisticLockWithGuards(context.container, {
      resourceKind: 'customers.interaction',
      resourceId: input.id,
      current: rowValue(existing, 'updatedAt', 'updated_at') as string | Date | null | undefined,
      request: context.request ?? null,
    })
  }
  let behavior: CalendarEventTypeBehavior | null
  try {
    behavior = await resolveVisitBehavior(context.container, tenantId, organizationId)
  } catch {
    return blocked('example.calendar.visitAvailability.retry', 503)
  }
  const decision = buildVisitAvailabilityCheck({
    input,
    existing: updating ? existing : null,
    behavior,
    enabledModules: visitEnabledModules(),
  })
  if (decision.kind === 'skip') return { ok: true }
  if (decision.kind === 'retry') return blocked('example.calendar.visitAvailability.retry', 503)
  if (decision.kind === 'invalidInterval') {
    return blocked('example.calendar.visitAvailability.invalidInterval', 422, ['scheduledAt', 'durationMinutes'])
  }
  const actorUserId = context.auth?.sub
  if (!actorUserId) return blocked('example.calendar.visitAvailability.retry', 503)
  const results = await evaluateVisitAvailability({
    container: context.container,
    actorUserId,
    scope: { tenantId, organizationId },
    input: decision.input,
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
