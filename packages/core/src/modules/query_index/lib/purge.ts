import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
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
  const db = em.getKysely<any>()
  const scope: JobScope = {
    entityType: options.entityType,
    organizationId: options.organizationId ?? null,
    tenantId: options.tenantId ?? null,
    partitionIndex: null,
    partitionCount: null,
  }

  const applyScope = <QB extends { where: (...args: any[]) => QB }>(q: QB): QB => {
    let chain = q.where('entity_type' as any, '=', options.entityType)
    if (options.organizationId !== undefined) {
      chain = chain.where(sql`organization_id is not distinct from ${options.organizationId ?? null}`)
    }
    if (options.tenantId !== undefined) {
      chain = chain.where(sql`tenant_id is not distinct from ${options.tenantId ?? null}`)
    }
    return chain
  }

  const totalRow = await applyScope(
    db.selectFrom('entity_indexes' as any).select(sql`count(*)`.as('count')),
  ).executeTakeFirst() as { count: unknown } | undefined

  const total = totalRow ? Number(totalRow.count) || 0 : 0

  await prepareJob(db, scope, 'purging', { totalCount: total })

  if (total > 0) {
    const result = await applyScope(
      db.deleteFrom('entity_indexes' as any) as any,
    ).executeTakeFirst() as { numDeletedRows?: bigint | number } | undefined
    const removed = Number(result?.numDeletedRows ?? 0)
    await updateJobProgress(db, scope, removed || total)
  } else {
    await updateJobProgress(db, scope, 0)
  }

  await finalizeJob(db, scope)
}
