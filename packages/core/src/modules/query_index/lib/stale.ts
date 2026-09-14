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

  // Projection and token sweeps share a transaction: the token sweep is an anti-join
  // against the projections this run just removed, so a failed token delete must take
  // the projection delete with it rather than leave the pair half-applied.
  await db.transaction().execute(async (trx) => {
    let q = trx.deleteFrom('entity_indexes' as any).where('entity_type' as any, '=', entityType)
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

    // Search tokens are written from the same (entity_type, entity_id, tenant_id,
    // organization_id) tuple as the projection, but nothing above ever touched them, so
    // every record this run stopped covering kept a queryable token with no presenter —
    // and token-only orphans left by earlier runs survived every rebuild since.
    let tokens = trx.deleteFrom('search_tokens' as any).where('entity_type' as any, '=', entityType)
    if (tenantId !== undefined) {
      tokens = tokens.where(sql<boolean>`tenant_id is not distinct from ${tenantId ?? null}`)
    }
    if (options.organizationId !== undefined) {
      tokens = tokens.where(sql<boolean>`organization_id is not distinct from ${options.organizationId ?? null}`)
    }
    if (partitionIndex != null && partitionCount != null) {
      tokens = tokens.where(sql<boolean>`mod(abs(hashtext(entity_id::text)), ${partitionCount}) = ${partitionIndex}`)
    }
    // Secondary guard only. `replaceSearchTokensForBatch` returns early for a record whose
    // tokens are unchanged, so a perfectly current record keeps tokens older than this run
    // — a timestamp-driven sweep would make live records unfindable. What this predicate
    // does earn is the concurrent-writer case: a batch inserts tokens before the matching
    // projection, so a token written during the run can outrun its own presenter.
    tokens = tokens.where('created_at' as any, '<', startedAt as any)
    if (options.excludeRecordIds?.length) {
      tokens = tokens.where('entity_id' as any, 'not in', options.excludeRecordIds)
    }
    // The load-bearing predicate: a token survives while any projection for its own record
    // and scope survives, soft-deleted ones included.
    tokens = tokens.where(sql<boolean>`not exists (
      select 1 from entity_indexes as surviving
      where surviving.entity_type = ${entityType}
        and surviving.entity_id = search_tokens.entity_id
        and surviving.tenant_id is not distinct from search_tokens.tenant_id
        and surviving.organization_id is not distinct from search_tokens.organization_id
    )`)
    await tokens.execute()
  })
}
