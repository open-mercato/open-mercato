import { type Kysely, sql } from 'kysely'
import { recordIndexerError } from '@open-mercato/shared/lib/indexers/error-log'

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

/**
 * `entity_indexes` ships in an earlier migration than `search_tokens`, so a deployment
 * running this code against a not-yet-migrated database has the projection table and not
 * the token table. The query engine probes the same way before reading the table
 * (`shared/lib/search/availability.ts`).
 */
async function searchTokensTableExists(db: Kysely<any>): Promise<boolean> {
  const row = await db
    .selectFrom('information_schema.tables' as any)
    .select(sql<number>`1`.as('one') as any)
    .where('table_name' as any, '=', 'search_tokens')
    .limit(1)
    .executeTakeFirst()
  return !!row
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

  // The token sweep runs as its own statement, after the projection delete has committed, and
  // deliberately cannot fail the run. Its anti-join only needs those deletes to be *visible*,
  // and a committed delete is as visible as an uncommitted one inside a shared transaction —
  // so wrapping the pair buys no correctness, only a new fatal path: `reindexer.ts` does not
  // guard this call and marks the whole job failed on a throw, so a statement timeout on a
  // large token delete would discard a rebuild whose projections all wrote successfully. The
  // fallback is the pre-fix steady state: orphan tokens survive, benign, until the next run
  // sweeps them. This matches how the module already treats token-side failures —
  // `batch.ts` records a failed token write via `recordIndexerError` rather than counting it
  // as a write failure, and `indexer.ts` swallows the token delete outside a transaction.
  try {
    if (!(await searchTokensTableExists(db))) return

    // Search tokens are written from the same (entity_type, entity_id, tenant_id,
    // organization_id) tuple as the projection, but nothing above ever touched them, so
    // every record this run stopped covering kept a queryable token with no presenter —
    // and token-only orphans left by earlier runs survived every rebuild since.
    let tokens = db.deleteFrom('search_tokens' as any).where('entity_type' as any, '=', entityType)
    // `= / is null` rather than the projection sweep's `is not distinct from`: these are bound
    // constants, so the two spellings are semantically identical here, but only the former can
    // serve as a btree index condition. Without it the delete uses just the `entity_type` prefix
    // of `search_tokens_presence_idx (entity_type, tenant_id, organization_id)` and a
    // tenant-scoped, unpartitioned run reads every tenant's tokens for that entity type —
    // the same planner trap `shared/lib/search/availability.ts` documents for this table (#4723).
    // The anti-join below keeps the null-safe form: it compares columns, not constants.
    if (tenantId !== undefined) {
      tokens = tenantId === null
        ? tokens.where('tenant_id' as any, 'is', null)
        : tokens.where('tenant_id' as any, '=', tenantId)
    }
    if (options.organizationId !== undefined) {
      tokens = options.organizationId === null
        ? tokens.where('organization_id' as any, 'is', null)
        : tokens.where('organization_id' as any, '=', options.organizationId)
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
    // and scope survives, soft-deleted ones included. `search_tokens` has a second writer —
    // `@open-mercato/search`'s token strategy writes rows for the same records under its own
    // `field` spellings — and this sweep is safe for those rows only because that strategy
    // draws its record set from the query engine, i.e. from the very projections consulted
    // here. Changing where that strategy gets its records would make this delete eat its rows.
    tokens = tokens.where(sql<boolean>`not exists (
      select 1 from entity_indexes as surviving
      where surviving.entity_type = ${entityType}
        and surviving.entity_id = search_tokens.entity_id
        and surviving.tenant_id is not distinct from search_tokens.tenant_id
        and surviving.organization_id is not distinct from search_tokens.organization_id
    )`)
    await tokens.execute()
  } catch (searchTokenError) {
    await recordIndexerError(
      { db },
      {
        source: 'fulltext',
        handler: 'query_index:purge-orphans',
        error: searchTokenError,
        entityType,
        tenantId: tenantId ?? null,
        organizationId: options.organizationId ?? null,
      },
    ).catch(() => undefined)
  }
}
