import { rename } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { IsolationLevel, raw, type EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { ResourcesResource, ResourcesResourceType } from '@open-mercato/core/modules/resources/data/entities'
import type { EventBus } from '@open-mercato/events'
import { emitCrudSideEffects, flushCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { CRUD_QUERY_INDEX_MANAGED_PAYLOAD_KEY } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { journalTarget, readJournal, writeJournal } from './journal'

const optionsSchema = z.discriminatedUnion('apply', [
  z.object({ tenant: z.string().uuid(), org: z.string().uuid(), apply: z.literal(false), journal: z.never().optional() }),
  z.object({ tenant: z.string().uuid(), org: z.string().uuid(), apply: z.literal(true), journal: z.string().min(1) }),
])

export async function runRepair(args: string[], bootstrap: () => Promise<void>) {
  const { values } = parseArgs({
    args,
    options: {
      tenant: { type: 'string' },
      org: { type: 'string' },
      apply: { type: 'boolean', default: false },
      journal: { type: 'string' },
    },
  })
  const { tenant, org, apply, journal } = optionsSchema.parse(values)
  const scope = { tenantId: tenant, organizationId: org }
  const liveScope = { ...scope, deletedAt: null }

  await bootstrap()
  const container = await createRequestContainer()
  try {
    const em = container.resolve<EntityManager>('em')
    const fork = em.fork()
    const target = journalTarget(em, tenant, org)
    const completed = journal && await readJournal(`${journal}.complete`, target)
    const pending = journal && !completed ? await readJournal(journal, target) : undefined
    let clearedIds: string[] = []
    let found = 0
    let replayed = 0

    if (pending) {
      const [transaction] = await fork.execute<Array<{ status: string | null }>>(
        'select pg_xact_status(?::xid8) as status', [pending.transactionId],
      )
      if (transaction.status !== 'committed') {
        throw new Error(`Repair transaction status is ${transaction.status ?? 'unknown'}. Inspect the journal before proceeding.`)
      }
      const current = await fork.createQueryBuilder(ResourcesResource)
        .select('id').where({ ...liveScope, id: { $in: pending.ids } }).execute<Array<{ id: string }>>('all')
      clearedIds = current.map(({ id }) => id)
      replayed = clearedIds.length
    } else if (!completed) {
      const result = await fork.transactional(async (tx) => {
        const liveTypes = tx.createQueryBuilder(ResourcesResourceType).select('id').where(liveScope)
        const invalidReferences = { ...liveScope, resourceTypeId: { $ne: null, $nin: liveTypes } }

        if (!apply) {
          return { found: await tx.count(ResourcesResource, invalidReferences), ids: [] }
        }

        const cleared = await tx.createQueryBuilder(ResourcesResource).update({
          resourceTypeId: null,
          updatedAt: raw("greatest(clock_timestamp(), updated_at + interval '1 millisecond')"),
        }).where(invalidReferences).returning('id').execute<Array<{ id: string }>>('all')

        const ids = cleared.map(({ id }) => id)
        if (ids.length) {
          const [transaction] = await tx.execute<Array<{ id: string }>>('select pg_current_xact_id()::text as id')
          await writeJournal(journal, { target, transactionId: transaction.id, ids })
        }
        return { found: ids.length, ids }
      }, { isolationLevel: IsolationLevel.SERIALIZABLE, readOnly: !apply })
      found = result.found
      clearedIds = result.ids
    }

    if (clearedIds.length) {
      const dataEngine = container.resolve<DataEngine>('dataEngine')
      for (const id of clearedIds) {
        await emitCrudSideEffects({
          dataEngine,
          action: 'updated',
          entity: em.getReference(ResourcesResource, id),
          identifiers: { id, ...scope },
          indexer: { entityType: 'resources:resources_resource' },
        })
      }
      await flushCrudSideEffects(dataEngine)
      const eventBus = container.resolve<EventBus>('eventBus')
      for (const id of clearedIds) {
        const payload = Object.defineProperty({ id, ...scope }, CRUD_QUERY_INDEX_MANAGED_PAYLOAD_KEY, { value: true })
        await eventBus.emitEvent('resources.resource.updated', payload, {
          ...scope,
          persistent: true,
          emitterModuleId: 'resources',
        })
      }
    }
    if (apply) await invalidateCrudCache(container, 'resources.resource', scope, tenant, 'resource-type-reference-repair')
    if (journal && (pending || clearedIds.length)) await rename(journal, `${journal}.complete`)
    return {
      mode: apply ? 'apply' : 'preview',
      found,
      cleared: pending ? 0 : clearedIds.length,
      ...(pending ? { replayed } : {}),
    }
  } finally {
    await container.dispose()
  }
}
