import { type Kysely, sql } from 'kysely'

type PurgeOrphansOptions = {
  entityType: string
  tenantId?: string | null
  organizationId?: string | null
  partitionIndex: number | null
  partitionCount: number | null
  startedAt: Date
  /**
   * Records whose index rows must be preserved even though this run did not refresh
   * them. A row that failed to be written still looks untouched to the `updated_at`
   * predicate below, so without this the purge would delete the very entries the run
   * failed to rebuild.
   */
  excludeRecordIds?: string[]
}

export async function purgeOrphans(
  db: Kysely<any>,
  options: PurgeOrphansOptions,
): Promise<void> {
  const { entityType, tenantId, partitionIndex, partitionCount, startedAt } = options
  let q = db.deleteFrom('entity_indexes' as any).where('entity_type' as any, '=', entityType)
  if (tenantId !== undefined) {
    q = q.where(sql<boolean>`tenant_id is not distinct from ${tenantId ?? null}`)
  }
  if (options.organizationId !== undefined) {
    q = q.where(sql<boolean>`organization_id is not distinct from ${options.organizationId ?? null}`)
  }
  if (partitionIndex != null && partitionCount != null) {
    q = q.where(sql<boolean>`mod(abs(hashtext(entity_id::text)), ${partitionCount}) = ${partitionIndex}`)
  }
  q = q.where('updated_at' as any, '<', startedAt as any)
  if (options.excludeRecordIds?.length) {
    q = q.where('entity_id' as any, 'not in', options.excludeRecordIds)
  }
  await q.execute()
}
