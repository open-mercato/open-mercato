import type { Knex } from 'knex'

export type JobScope = {
  entityType: string
  organizationId?: string | null
  tenantId?: string | null
  partitionIndex?: number | null
  partitionCount?: number | null
}

function scopeQuery(knex: Knex, scope: JobScope) {
  let query = knex('entity_index_jobs').where('entity_type', scope.entityType)
  query = query.andWhereRaw('organization_id is not distinct from ?', [scope.organizationId ?? null])
  query = query.andWhereRaw('tenant_id is not distinct from ?', [scope.tenantId ?? null])
  query = query.andWhereRaw('partition_index is not distinct from ?', [scope.partitionIndex ?? null])
  query = query.andWhereRaw('partition_count is not distinct from ?', [scope.partitionCount ?? null])
  return query
}

export async function prepareJob(
  knex: Knex,
  scope: JobScope,
  status: 'reindexing' | 'purging',
  options: { totalCount?: number | null } = {},
) {
  const base = {
    organization_id: scope.organizationId ?? null,
    tenant_id: scope.tenantId ?? null,
    partition_index: scope.partitionIndex ?? null,
    partition_count: scope.partitionCount ?? null,
    status,
    started_at: knex.fn.now(),
    finished_at: null,
    heartbeat_at: knex.fn.now(),
    processed_count: 0,
    total_count: options.totalCount ?? null,
  }
  const existing = await scopeQuery(knex, scope).first<{ id: string }>()
  if (existing) {
    await scopeQuery(knex, scope).update(base)
    return existing.id
  }
  const inserted = await knex('entity_index_jobs')
    .insert({
      entity_type: scope.entityType,
      ...base,
    })
    .returning<{ id: string }[]>('id')
  return inserted?.[0]?.id ?? null
}

export async function updateJobProgress(
  knex: Knex,
  scope: JobScope,
  processedDelta: number,
) {
  await scopeQuery(knex, scope).update({
    processed_count: knex.raw('coalesce(processed_count, 0) + ?', [Math.max(0, processedDelta)]),
    heartbeat_at: knex.fn.now(),
  })
}

export async function finalizeJob(
  knex: Knex,
  scope: JobScope,
) {
  await scopeQuery(knex, scope).update({
    finished_at: knex.fn.now(),
    heartbeat_at: knex.fn.now(),
  })
}

