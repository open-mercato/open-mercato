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
