import type { EntityManager } from '@mikro-orm/postgresql'
import type {
  CommandBus,
  CommandExecutionOptions,
  CommandExecuteResult,
} from '@open-mercato/shared/lib/commands'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'

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
  for (const key of keys) {
    await em.getConnection().execute(
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
  queryEngine: QueryEngine,
  tenantId: string,
  id: string,
  options: CommandExecutionOptions<unknown>,
): Promise<Row | null> {
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

export function createVisitBookingSerializingCommandBus(args: {
  commandBus: CommandBus
  em: EntityManager
  queryEngine: QueryEngine
}): CommandBus {
  const { commandBus, em, queryEngine } = args

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
    const input = options.input as Row
    const tenantId = options.ctx.auth?.tenantId ?? value(input, 'tenantId', 'tenant_id')
    if (typeof tenantId !== 'string') return commandBus.execute<TInput, TResult>(commandId, options)

    return em.fork().transactional(async (lockEm) => {
      let existing: Row | null = null
      if (commandId === 'customers.interactions.update') {
        const interactionId = input.id
        if (typeof interactionId !== 'string') return commandBus.execute<TInput, TResult>(commandId, options)
        await acquireLocks(lockEm, [`example:visit-booking:${tenantId}:interaction:${interactionId}`])
        existing = await loadInteraction(queryEngine, tenantId, interactionId, options as CommandExecutionOptions<unknown>)
      }
      const organizationId = value(existing ?? input, 'organizationId', 'organization_id')
        ?? options.ctx.selectedOrganizationId
        ?? options.ctx.auth?.orgId
      if (typeof organizationId !== 'string') return commandBus.execute<TInput, TResult>(commandId, options)
      await acquireLocks(lockEm, subjectLockKeys({ tenantId, organizationId, input, existing }))
      return commandBus.execute<TInput, TResult>(commandId, options)
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
