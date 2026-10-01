import type { EntityManager } from '@mikro-orm/postgresql'
import type {
  CommandBus,
  CommandExecutionOptions,
  CommandExecuteResult,
} from '@open-mercato/shared/lib/commands'
import { CommandInterceptorError } from '@open-mercato/shared/lib/commands'
import { BasicQueryEngine } from '@open-mercato/shared/lib/query/engine'
import { bookedVisitSubjects } from './visitBookings'
import { visitAvailabilityInputSchema, type VisitAvailabilitySubject } from './visitAvailability'

type Row = Record<string, unknown>

const INTERACTION_FIELDS = [
  'id',
  'tenant_id',
  'organization_id',
  'participants',
  'owner_user_id',
  'linked_entities',
]

function value(row: Row, camel: string, snake: string): unknown {
  return row[camel] ?? row[snake]
}

function arrayValue(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'string') return []
  const parsed: unknown = JSON.parse(raw)
  return Array.isArray(parsed) ? parsed : []
}

function staffUserIds(participants: unknown, ownerUserId: unknown): string[] {
  const ids = arrayValue(participants).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const participant = item as Row
    return participant.isCustomer !== true && participant.status !== 'customer' && typeof participant.userId === 'string'
      ? [participant.userId]
      : []
  })
  if (typeof ownerUserId === 'string') ids.push(ownerUserId)
  return [...new Set(ids)]
}

function resourceIds(links: unknown): string[] {
  return [...new Set(arrayValue(links).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const link = item as Row
    return link.type === 'resource' && typeof link.id === 'string' ? [link.id] : []
  }))]
}

function subjectLockKeys(args: {
  tenantId: string
  organizationId: string
  input: Row
  existing?: Row | null
}): string[] {
  const { tenantId, organizationId, input, existing } = args
  const existingParticipants = value(existing ?? {}, 'participants', 'participants')
  const existingOwnerUserId = value(existing ?? {}, 'ownerUserId', 'owner_user_id')
  const existingLinks = value(existing ?? {}, 'linkedEntities', 'linked_entities')
  const nextParticipants = 'participants' in input ? input.participants : existingParticipants
  const nextOwnerUserId = 'ownerUserId' in input || 'owner_user_id' in input
    ? value(input, 'ownerUserId', 'owner_user_id')
    : existingOwnerUserId
  const nextLinks = 'linkedEntities' in input || 'linked_entities' in input
    ? value(input, 'linkedEntities', 'linked_entities')
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
    await em.execute(
      'select pg_advisory_xact_lock(hashtextextended(?::text, 0))',
      [key],
    )
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
): Promise<Row | null> {
  const queryEngine = new BasicQueryEngine(em)
  const organizationIds = scopedOrganizationIds(options)
  const result = await queryEngine.query<Row>('customers:customer_interaction', {
    tenantId,
    ...(organizationIds === null ? {} : { organizationIds }),
    filters: { id, deleted_at: null },
    fields: INTERACTION_FIELDS,
    page: { page: 1, pageSize: 1 },
  })
  return result.items[0] ?? null
}

function nextValue(input: Row, existing: Row | null, camel: string, snake: string): unknown {
  return camel in input || snake in input ? value(input, camel, snake) : value(existing ?? {}, camel, snake)
}

async function assertNoOverlappingVisit(
  em: EntityManager,
  tenantId: string,
  organizationId: string,
  input: Row,
  existing: Row | null,
): Promise<void> {
  const interactionType = value(input, 'interactionType', 'interaction_type')
    ?? value(existing ?? {}, 'interactionType', 'interaction_type')
  if (interactionType !== 'visit') return
  const scheduledAt = nextValue(input, existing, 'scheduledAt', 'scheduled_at')
  const durationMinutes = nextValue(input, existing, 'durationMinutes', 'duration_minutes')
  const allDay = nextValue(input, existing, 'allDay', 'all_day')
  const recurrenceRule = nextValue(input, existing, 'recurrenceRule', 'recurrence_rule')
  if (allDay === true || recurrenceRule || typeof durationMinutes !== 'number' || !Number.isInteger(durationMinutes) || durationMinutes <= 0) return
  const start = scheduledAt instanceof Date ? scheduledAt : new Date(typeof scheduledAt === 'string' ? scheduledAt : '')
  if (Number.isNaN(start.getTime())) return
  const participants = nextValue(input, existing, 'participants', 'participants')
  const links = nextValue(input, existing, 'linkedEntities', 'linked_entities')
  const subjects: VisitAvailabilitySubject[] = [
    ...staffUserIds(participants, null).map((id): VisitAvailabilitySubject => ({ type: 'staff', id, status: 'available', reasonKey: null })),
    ...resourceIds(links).map((id): VisitAvailabilitySubject => ({ type: 'resource', id, status: 'available', reasonKey: null })),
  ]
  if (!subjects.length) return
  const parsed = visitAvailabilityInputSchema.safeParse({
    startAt: start.toISOString(),
    endAt: new Date(start.getTime() + durationMinutes * 60000).toISOString(),
    staffUserIds: subjects.filter((subject) => subject.type === 'staff').map((subject) => subject.id),
    resourceIds: subjects.filter((subject) => subject.type === 'resource').map((subject) => subject.id),
    ...(typeof existing?.id === 'string' ? { excludeInteractionId: existing.id } : {}),
  })
  if (!parsed.success) return
  let booked: Set<string>
  try {
    booked = await bookedVisitSubjects({
      queryEngine: new BasicQueryEngine(em),
      scope: { tenantId, organizationId },
      input: parsed.data,
      subjects,
    })
  } catch (cause) {
    const reasonKey = 'example.calendar.visitAvailability.retry'
    throw new CommandInterceptorError(reasonKey, {
      status: 503,
      body: { error: reasonKey, code: 'visit_availability_unavailable' },
      cause,
    })
  }
  const conflicts = subjects.filter((subject) => booked.has(`${subject.type}:${subject.id}`))
  if (!conflicts.length) return
  const reasonKey = 'example.calendar.visitAvailability.booked'
  throw new CommandInterceptorError(reasonKey, {
    status: 422,
    body: {
      error: reasonKey,
      code: 'visit_availability_unavailable',
      subjects: conflicts.map((subject) => ({ ...subject, status: 'unavailable', reasonKey })),
      fieldErrors: Object.fromEntries([...new Set(conflicts.map((subject) => subject.type === 'staff' ? 'participants' : 'linkedEntities'))]
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
    const originalInput = options.input as Row

    const writeEm = options.ctx.transactionalEm ?? em
    const previousBeforeWrite = options.ctx.beforeTransactionalWrite
    const beforeTransactionalWrite = async (lockEm: EntityManager, effectiveInput?: unknown) => {
      await previousBeforeWrite?.(lockEm, effectiveInput)
      const input = effectiveInput && typeof effectiveInput === 'object'
        ? effectiveInput as Row
        : originalInput
      const tenantId = options.ctx.auth?.tenantId ?? value(input, 'tenantId', 'tenant_id')
      if (typeof tenantId !== 'string') return
      let existing: Row | null = null
      if (commandId === 'customers.interactions.update') {
        const interactionId = input.id
        if (typeof interactionId !== 'string') return
        await acquireLocks(lockEm, [`example:visit-booking:${tenantId}:interaction:${interactionId}`])
        existing = await loadInteraction(lockEm, tenantId, interactionId, options as CommandExecutionOptions<unknown>)
      }
      const organizationId = value(existing ?? input, 'organizationId', 'organization_id')
        ?? options.ctx.selectedOrganizationId
        ?? options.ctx.auth?.orgId
      if (typeof organizationId !== 'string') return
      await acquireLocks(lockEm, subjectLockKeys({ tenantId, organizationId, input, existing }))
      await assertNoOverlappingVisit(lockEm, tenantId, organizationId, input, existing)
    }
    return commandBus.execute<TInput, TResult>(commandId, {
      ...options,
      ctx: {
        ...options.ctx,
        transactionalEm: writeEm,
        beforeTransactionalWrite,
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
