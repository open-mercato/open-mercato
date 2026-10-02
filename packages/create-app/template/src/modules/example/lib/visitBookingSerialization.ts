import type { EntityManager } from '@mikro-orm/postgresql'
import type {
  CommandBus,
  CommandExecutionOptions,
  CommandExecuteResult,
} from '@open-mercato/shared/lib/commands'
import { CommandInterceptorError } from '@open-mercato/shared/lib/commands'
import { BasicQueryEngine } from '@open-mercato/shared/lib/query/engine'
import type { CalendarEventTypeBehavior } from '@open-mercato/core/modules/customers/calendar-event-types'
import { evaluateVisitAvailability, type VisitAvailabilitySubject } from './visitAvailability'
import {
  VISIT_INTERACTION_FIELDS,
  VISIT_TYPE_PROBE_FIELDS,
  VisitAvailabilityDataError,
  buildVisitAvailabilityCheck,
  hasAvailabilityChange,
  requiresVisitAvailabilityCheck,
  resolveVisitBehavior,
  resourceIds,
  rowValue,
  staffUserIds,
  visitEnabledModules,
  visitTypeKey,
  type VisitRow,
} from './visitAvailabilityDecision'

const RETRY_REASON_KEY = 'example.calendar.visitAvailability.retry'

function retryError(cause?: unknown): CommandInterceptorError {
  return new CommandInterceptorError(RETRY_REASON_KEY, {
    status: 503,
    body: { error: RETRY_REASON_KEY, code: 'visit_availability_unavailable' },
    ...(cause === undefined ? {} : { cause }),
  })
}

function subjectLockKeys(args: {
  tenantId: string
  organizationId: string
  input: VisitRow
  existing?: VisitRow | null
}): string[] {
  const { tenantId, organizationId, input, existing } = args
  const existingParticipants = rowValue(existing ?? {}, 'participants', 'participants')
  const existingOwnerUserId = rowValue(existing ?? {}, 'ownerUserId', 'owner_user_id')
  const existingLinks = rowValue(existing ?? {}, 'linkedEntities', 'linked_entities')
  const nextParticipants = 'participants' in input ? input.participants : existingParticipants
  const nextOwnerUserId = 'ownerUserId' in input || 'owner_user_id' in input
    ? rowValue(input, 'ownerUserId', 'owner_user_id')
    : existingOwnerUserId
  const nextLinks = 'linkedEntities' in input || 'linked_entities' in input
    ? rowValue(input, 'linkedEntities', 'linked_entities')
    : existingLinks
  const prefix = `example:visit-booking:${tenantId}:${organizationId}`
  const staffIds = new Set([
    ...staffUserIds(existingParticipants, existingOwnerUserId),
    ...staffUserIds(nextParticipants, nextOwnerUserId),
  ])
  const resourceSubjectIds = new Set([
    ...resourceIds(existingLinks),
    ...resourceIds(nextLinks),
  ])
  return [
    ...[...staffIds].map((id) => `${prefix}:staff:${id}`),
    ...[...resourceSubjectIds].map((id) => `${prefix}:resource:${id}`),
  ].sort()
}

async function acquireLocks(em: EntityManager, keys: string[]): Promise<void> {
  if (!em.isInTransaction()) {
    throw new Error('[internal] Visit booking locks require an active transaction')
  }
  for (const key of keys) {
    try {
      await em.execute(
        'select pg_advisory_xact_lock(hashtextextended(?::text, 0))',
        [key],
      )
    } catch (cause) {
      throw retryError(cause)
    }
  }
}

function scopedOrganizationIds(options: CommandExecutionOptions<unknown>): string[] | null {
  if (options.ctx.organizationIds !== null) return options.ctx.organizationIds
  const allowedIds = options.ctx.organizationScope?.allowedIds
  return Array.isArray(allowedIds) ? allowedIds : null
}

async function loadInteraction(
  em: EntityManager,
  tenantId: string,
  id: string,
  options: CommandExecutionOptions<unknown>,
  fields: readonly string[],
): Promise<VisitRow | null> {
  const queryEngine = new BasicQueryEngine(em)
  const organizationIds = scopedOrganizationIds(options)
  try {
    const result = await queryEngine.query<VisitRow>('customers:customer_interaction', {
      tenantId,
      ...(organizationIds === null ? {} : { organizationIds }),
      filters: { id, deleted_at: null },
      fields: [...fields],
      page: { page: 1, pageSize: 1 },
    })
    return result.items[0] ?? null
  } catch (cause) {
    throw retryError(cause)
  }
}

async function assertVisitAvailable(
  em: EntityManager,
  tenantId: string,
  organizationId: string,
  input: VisitRow,
  existing: VisitRow | null,
  behavior: CalendarEventTypeBehavior | null,
  options: CommandExecutionOptions<unknown>,
): Promise<void> {
  const decision = buildVisitAvailabilityCheck({
    input,
    existing,
    behavior,
    enabledModules: visitEnabledModules(),
  })
  if (decision.kind === 'skip') return
  if (decision.kind === 'retry') throw retryError()
  if (decision.kind === 'invalidInterval') {
    const reasonKey = 'example.calendar.visitAvailability.invalidInterval'
    throw new CommandInterceptorError(reasonKey, {
      status: 422,
      body: {
        error: reasonKey,
        code: 'visit_availability_unavailable',
        fieldErrors: { scheduledAt: reasonKey, durationMinutes: reasonKey },
      },
    })
  }
  const actorUserId = options.ctx.auth?.sub
  if (!actorUserId) throw retryError()
  let results: VisitAvailabilitySubject[]
  try {
    results = await evaluateVisitAvailability({
      container: options.ctx.container,
      actorUserId,
      scope: { tenantId, organizationId },
      input: decision.input,
      queryEngine: new BasicQueryEngine(em),
    })
  } catch (cause) {
    throw retryError(cause)
  }
  const failure = results.find((subject) => subject.status === 'unknown')
    ?? results.find((subject) => subject.status === 'unavailable')
  if (!failure) return
  const reasonKey = failure.reasonKey ?? RETRY_REASON_KEY
  const unavailable = results.filter((subject) => subject.status !== 'available')
  throw new CommandInterceptorError(reasonKey, {
    status: reasonKey === 'example.calendar.visitAvailability.missingScope'
      ? 403
      : failure.status === 'unknown' ? 503 : 422,
    body: {
      error: reasonKey,
      code: 'visit_availability_unavailable',
      subjects: unavailable,
      fieldErrors: Object.fromEntries([...new Set(unavailable.map((subject) => subject.type === 'staff' ? 'participants' : 'linkedEntities'))]
        .map((field) => [field, reasonKey])),
    },
  })
}

export function createVisitBookingSerializingCommandBus(args: {
  commandBus: CommandBus
  em: EntityManager
}): CommandBus {
  const { commandBus, em } = args

  async function execute<TInput = unknown, TResult = unknown>(
    commandId: string,
    options: CommandExecutionOptions<TInput>,
  ): Promise<CommandExecuteResult<TResult>> {
    if (commandId !== 'customers.interactions.create' && commandId !== 'customers.interactions.update') {
      return commandBus.execute<TInput, TResult>(commandId, options)
    }
    if (!options.input || typeof options.input !== 'object') {
      return commandBus.execute<TInput, TResult>(commandId, options)
    }
    const originalInput = options.input as VisitRow
    const updating = commandId === 'customers.interactions.update'

    const writeEm = options.ctx.transactionalEm ?? em
    const previousBeforeWrite = options.ctx.beforeTransactionalWrite
    const beforeTransactionalWrite = async (lockEm: EntityManager, effectiveInput?: unknown) => {
      await previousBeforeWrite?.(lockEm, effectiveInput)
      const input = effectiveInput && typeof effectiveInput === 'object'
        ? effectiveInput as VisitRow
        : originalInput
      const tenantId = options.ctx.auth?.tenantId ?? rowValue(input, 'tenantId', 'tenant_id')
      if (typeof tenantId !== 'string') return
      // Non-Visit writes must not pay for an advisory lock or a record read: every
      // interaction of every type in every tenant goes through this wrapper.
      const suppliedType = visitTypeKey(rowValue(input, 'interactionType', 'interaction_type'))
      if (suppliedType !== null && suppliedType !== 'visit') return
      if (!updating && suppliedType !== 'visit') return
      let probe: VisitRow | null = null
      if (updating) {
        const interactionId = input.id
        if (typeof interactionId !== 'string') return
        if (!hasAvailabilityChange(input)) return
        probe = await loadInteraction(lockEm, tenantId, interactionId, options as CommandExecutionOptions<unknown>, VISIT_TYPE_PROBE_FIELDS)
        // Known window, accepted on purpose: this probe runs before the
        // per-interaction lock, so a write that omits the type can read
        // `meeting` while a concurrent transaction is still converting the same
        // row to a Visit, skip here, and then land an unchecked time on what has
        // become a Visit. Closing it means an advisory lock and a second read on
        // every availability-touching update of every non-Visit interaction in
        // every tenant, which is the cost the early return above exists to avoid.
        // A client that sends the optimistic-lock header is already protected:
        // the conversion bumps `updated_at`, so the stale write is rejected.
        if (suppliedType !== 'visit' && visitTypeKey(rowValue(probe ?? {}, 'interactionType', 'interaction_type')) !== 'visit') return
      }
      const organizationId = rowValue(probe ?? input, 'organizationId', 'organization_id')
        ?? options.ctx.selectedOrganizationId
        ?? options.ctx.auth?.orgId
      if (typeof organizationId !== 'string') return
      // Resolved before any advisory lock: the catalog service reads through the
      // request container's own EntityManager, so doing it under the locks would
      // hold them while waiting on a second pool connection.
      let behavior: CalendarEventTypeBehavior | null
      try {
        behavior = await resolveVisitBehavior(options.ctx.container, tenantId, organizationId)
      } catch (cause) {
        throw retryError(cause)
      }
      let existing: VisitRow | null = null
      if (updating && typeof input.id === 'string') {
        await acquireLocks(lockEm, [`example:visit-booking:${tenantId}:interaction:${input.id}`])
        existing = await loadInteraction(lockEm, tenantId, input.id, options as CommandExecutionOptions<unknown>, VISIT_INTERACTION_FIELDS)
      }
      const required = requiresVisitAvailabilityCheck({ updating, input, existing })
      if (required === 'skip') return
      if (required === 'retry') throw retryError()
      await acquireLocks(lockEm, subjectLockKeys({ tenantId, organizationId, input, existing }))
      await assertVisitAvailable(
        lockEm,
        tenantId,
        organizationId,
        input,
        existing,
        behavior,
        options as CommandExecutionOptions<unknown>,
      )
    }
    return commandBus.execute<TInput, TResult>(commandId, {
      ...options,
      ctx: {
        ...options.ctx,
        transactionalEm: writeEm,
        beforeTransactionalWrite: async (lockEm: EntityManager, effectiveInput?: unknown) => {
          try {
            await beforeTransactionalWrite(lockEm, effectiveInput)
          } catch (error) {
            if (error instanceof VisitAvailabilityDataError) throw retryError(error)
            throw error
          }
        },
      },
    })
  }

  return new Proxy(commandBus, {
    get(target, property, receiver) {
      if (property === 'execute') return execute
      const member = Reflect.get(target, property, receiver) as unknown
      return typeof member === 'function' ? member.bind(target) : member
    },
  })
}
