import type { EntityManager } from '@mikro-orm/postgresql'
import type { Knex } from 'knex'
import { prepareJob, updateJobProgress, finalizeJob, type JobScope } from './jobs'

export type PurgeOptions = {
  entityType: string
  organizationId?: string | null
  tenantId?: string | null
}

export async function purgeIndexScope(
  em: EntityManager,
  options: PurgeOptions,
): Promise<void> {
  const knex = (em as any).getConnection().getKnex() as Knex
  const scope: JobScope = {
    entityType: options.entityType,
    organizationId: options.organizationId ?? null,
    tenantId: options.tenantId ?? null,
    partitionIndex: null,
    partitionCount: null,
  }

  const countQuery = knex('entity_indexes')
    .where({ entity_type: options.entityType })
    .modify((qb) => {
      qb.andWhereRaw('organization_id is not distinct from ?', [options.organizationId ?? null])
      qb.andWhereRaw('tenant_id is not distinct from ?', [options.tenantId ?? null])
    })

  const totalRow = await countQuery.clone().count<{ count: unknown }>({ count: '*' }).first()
  const total = totalRow ? Number(totalRow.count) || 0 : 0

  await prepareJob(knex, scope, 'purging', { totalCount: total })

  if (total > 0) {
    const updated = await countQuery
      .clone()
      .update({ deleted_at: knex.fn.now(), updated_at: knex.fn.now() })
    await updateJobProgress(knex, scope, typeof updated === 'number' ? updated : total)
  } else {
    await updateJobProgress(knex, scope, 0)
  }

  await finalizeJob(knex, scope)
}

