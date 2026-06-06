import { type Kysely, sql } from 'kysely'

export type JobScope = {
  entityType: string
  organizationId?: string | null
  tenantId?: string | null
  partitionIndex?: number | null
  partitionCount?: number | null
}

function applyScopeWhere<QB extends { where: (...args: any[]) => QB }>(
  builder: QB,
  scope: JobScope,
): QB {
  let q = builder.where('entity_type' as any, '=', scope.entityType)
  q = q.where(sql`organization_id is not distinct from ${scope.organizationId ?? null}`)
  q = q.where(sql`tenant_id is not distinct from ${scope.tenantId ?? null}`)
  q = q.where(sql`partition_index is not distinct from ${scope.partitionIndex ?? null}`)
  q = q.where(sql`partition_count is not distinct from ${scope.partitionCount ?? null}`)
  return q
}

// True when ON CONFLICT could not infer an arbiter index (Postgres SQLSTATE
// 42P10) — i.e. entity_index_jobs_scope_unique is not present yet. Used to scope
// prepareJob's fallback to the missing-index case only.
function isMissingConflictArbiterError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null | undefined)?.code
  if (code === '42P10') return true
  const message = (err as { message?: unknown } | null | undefined)?.message
  return typeof message === 'string'
    && /no unique or exclusion constraint matching the on conflict/i.test(message)
}

export async function prepareJob(
  db: Kysely<any>,
  scope: JobScope,
  status: 'reindexing' | 'purging',
  options: { totalCount?: number | null } = {},
): Promise<string | null> {
  const base = {
    organization_id: scope.organizationId ?? null,
    tenant_id: scope.tenantId ?? null,
    partition_index: scope.partitionIndex ?? null,
    partition_count: scope.partitionCount ?? null,
    status,
    started_at: sql`now()`,
    finished_at: null,
    heartbeat_at: sql`now()`,
    processed_count: 0,
    total_count: options.totalCount ?? null,
  }

  // Single atomic upsert keyed by the coalesced scope tuple. This closes the
  // read-then-write race where two concurrent schedulers each see "no row" and
  // both INSERT a duplicate for the same scope, after which updateJobProgress /
  // finalizeJob corrupt each other's progress and finish state (#2739). The
  // ON CONFLICT target must match entity_index_jobs_scope_unique exactly.
  try {
    const upserted = await db
      .insertInto('entity_index_jobs' as any)
      .values({ entity_type: scope.entityType, ...base } as any)
      .onConflict((oc: any) => oc
        .expression(sql`
          "entity_type",
          coalesce("organization_id", '00000000-0000-0000-0000-000000000000'::uuid),
          coalesce("tenant_id", '00000000-0000-0000-0000-000000000000'::uuid),
          coalesce("partition_index", -1),
          coalesce("partition_count", -1)
        `)
        .doUpdateSet({
          status,
          started_at: sql`now()`,
          finished_at: null,
          heartbeat_at: sql`now()`,
          processed_count: 0,
          total_count: options.totalCount ?? null,
        } as any))
      .returning(['id' as any])
      .execute() as Array<{ id: string }>
    return upserted?.[0]?.id ?? null
  } catch (err) {
    // Only degrade to the legacy path when the scope unique index is absent
    // (e.g. a rolling deploy running this code against the pre-migration schema):
    // Postgres raises 42P10. Any other failure is real and must surface rather
    // than silently fall back to the racy read-then-write path and re-open #2739.
    if (!isMissingConflictArbiterError(err)) throw err
    return prepareJobLegacy(db, scope, base)
  }
}

// Pre-#2739 read-then-write path. Retained only as a fallback when the
// entity_index_jobs scope unique index is unavailable; it carries the original
// (racy) semantics and must never be reached once the migration has applied.
async function prepareJobLegacy(
  db: Kysely<any>,
  scope: JobScope,
  base: Record<string, unknown>,
): Promise<string | null> {
  const existing = await applyScopeWhere(
    db.selectFrom('entity_index_jobs' as any).select(['id' as any]),
    scope,
  ).executeTakeFirst() as { id: string } | undefined

  if (existing) {
    await applyScopeWhere(
      db.updateTable('entity_index_jobs' as any).set(base as any) as any,
      scope,
    ).execute()
    return existing.id
  }

  const inserted = await db
    .insertInto('entity_index_jobs' as any)
    .values({
      entity_type: scope.entityType,
      ...base,
    } as any)
    .returning(['id' as any])
    .execute() as Array<{ id: string }>

  return inserted?.[0]?.id ?? null
}

export async function updateJobProgress(
  db: Kysely<any>,
  scope: JobScope,
  processedDelta: number,
): Promise<void> {
  await applyScopeWhere(
    db.updateTable('entity_index_jobs' as any).set({
      processed_count: sql`coalesce(processed_count, 0) + ${Math.max(0, processedDelta)}`,
      heartbeat_at: sql`now()`,
    } as any) as any,
    scope,
  ).execute()
}

export async function finalizeJob(
  db: Kysely<any>,
  scope: JobScope,
): Promise<void> {
  await applyScopeWhere(
    db.updateTable('entity_index_jobs' as any).set({
      finished_at: sql`now()`,
      heartbeat_at: sql`now()`,
    } as any) as any,
    scope,
  ).execute()
}
