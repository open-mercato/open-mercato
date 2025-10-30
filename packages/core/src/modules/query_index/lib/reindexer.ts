import type { EntityManager } from '@mikro-orm/postgresql'
import type { Knex } from 'knex'
import { resolveEntityTableName } from '@open-mercato/shared/lib/query/engine'
import { upsertIndexBatch, type AnyRow } from './batch'
import { refreshCoverageSnapshot, writeCoverageCounts, applyCoverageAdjustments } from './coverage'
import { prepareJob, updateJobProgress, finalizeJob, type JobScope } from './jobs'
import { purgeStalePartitionIndexes, purgeUnprocessedPartitionIndexes } from './stale'

export type ReindexJobOptions = {
  entityType: string
  tenantId?: string | null
  force?: boolean
  batchSize?: number
  emitVectorizeEvents?: boolean
  eventBus?: {
    emitEvent(event: string, payload: any, options?: any): Promise<void>
  }
  partitionCount?: number
  partitionIndex?: number
  resetCoverage?: boolean
  onProgress?: (info: { processed: number; total: number; chunkSize: number }) => void
}

export type ReindexJobResult = {
  processed: number
  total: number
  tenantScopes: Array<string | null>
}

export const DEFAULT_REINDEX_PARTITIONS = 5
const DEFAULT_BATCH_SIZE = 500
const deriveOrgFromId = new Set<string>(['directory:organization'])
const COVERAGE_REFRESH_THROTTLE_MS = 5 * 60 * 1000
const lastCoverageReset = new Map<string, number>()

function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

async function getColumnSet(knex: Knex, tableName: string): Promise<Set<string>> {
  try {
    const info = await knex(tableName).columnInfo()
    return new Set(Object.keys(info).map((key) => key.toLowerCase()))
  } catch {
    return new Set<string>()
  }
}

export async function reindexEntity(
  em: EntityManager,
  options: ReindexJobOptions,
): Promise<ReindexJobResult> {
  const entityType = String(options?.entityType || '')
  if (!entityType) return { processed: 0, total: 0, tenantScopes: [] }
  const tenantId = options?.tenantId
  const force = options?.force === true
  const batchSize = Number.isFinite(options?.batchSize) && options!.batchSize! > 0
    ? Math.max(1, Math.trunc(options!.batchSize!))
    : DEFAULT_BATCH_SIZE
  const emitVectorize = options?.emitVectorizeEvents === true
  const eventBus = options?.eventBus
  const partitionCountRaw = Number.isFinite(options?.partitionCount)
    ? Math.max(1, Math.trunc(options!.partitionCount!))
    : 1
  const usingPartitions = partitionCountRaw > 1
  const partitionIndexRaw = Number.isFinite(options?.partitionIndex)
    ? Math.max(0, Math.trunc(options!.partitionIndex!))
    : 0
  const partitionIndex = usingPartitions
    ? Math.min(partitionIndexRaw, partitionCountRaw - 1)
    : null
  const resetCoverage = options?.resetCoverage ?? (!usingPartitions || partitionIndex === 0)

  const knex = (em as any).getConnection().getKnex() as Knex
  const table = resolveEntityTableName(em, entityType)
  const columns = await getColumnSet(knex, table)
  const hasOrgCol = columns.has('organization_id')
  const hasTenantCol = columns.has('tenant_id')
  const hasDeletedCol = columns.has('deleted_at')

  const jobScope: JobScope = {
    entityType,
    organizationId: null,
    tenantId: tenantId ?? null,
    partitionIndex,
    partitionCount: usingPartitions ? partitionCountRaw : null,
  }

  if (!force) {
    const activeJob = await (async () => {
      let query = knex('entity_index_jobs')
        .where('entity_type', entityType)
        .whereNull('finished_at')
      query = query.whereRaw('organization_id is not distinct from ?', [null])
      query = query.whereRaw('tenant_id is not distinct from ?', [tenantId ?? null])
      query = query.whereRaw('partition_index is not distinct from ?', [partitionIndex])
      query = query.whereRaw('partition_count is not distinct from ?', [usingPartitions ? partitionCountRaw : null])
      return query.first()
    })()
    if (activeJob) {
      return { processed: 0, total: 0, tenantScopes: [] }
    }
  }

  const scopeKey = (tenantValue: string | null) => `${tenantValue ?? '__null__'}`
  const baseWhere = (builder: Knex.QueryBuilder<any, any>) => {
    if (hasDeletedCol) builder.whereNull('b.deleted_at')
    if (tenantId !== undefined && hasTenantCol) {
      if (tenantId === null) builder.whereNull('b.tenant_id')
      else builder.where('b.tenant_id', tenantId)
    }
    if (usingPartitions && partitionIndex !== null) {
      builder.whereRaw('mod(abs(hashtext(b.id::text)), ?) = ?', [partitionCountRaw, partitionIndex])
    }
  }

  const baseCounts = new Map<string | null, number>()
  if (hasTenantCol && tenantId === undefined) {
    const rows = await knex({ b: table })
      .modify(baseWhere)
      .select(knex.raw('b.tenant_id as tenant_id'))
      .count<{ count: unknown }[]>({ count: '*' })
      .groupBy('b.tenant_id')
    for (const row of rows) {
      const tenantValue = (row as any)?.tenant_id ?? null
      const count = toNumber((row as any)?.count)
      baseCounts.set(tenantValue, count)
    }
  } else {
    const row = await knex({ b: table })
      .modify(baseWhere)
      .count({ count: '*' })
      .first()
    const key = tenantId === undefined ? null : tenantId ?? null
    baseCounts.set(key, toNumber(row?.count))
  }

  const total = Array.from(baseCounts.values()).reduce((acc, value) => acc + (Number.isFinite(value) ? value : 0), 0)
  await prepareJob(knex, jobScope, 'reindexing', { totalCount: total })
  const jobRow = await knex('entity_index_jobs')
    .where({ entity_type: entityType })
    .whereNull('organization_id')
    .andWhereRaw('tenant_id is not distinct from ?', [tenantId ?? null])
    .andWhereRaw('partition_index is not distinct from ?', [partitionIndex])
    .andWhereRaw('partition_count is not distinct from ?', [usingPartitions ? partitionCountRaw : null])
    .orderBy('started_at', 'desc')
    .first<{ started_at: Date }>()
  const jobStartedAt = jobRow?.started_at ? new Date(jobRow.started_at) : new Date()
  const deriveOrg = deriveOrgFromId.has(entityType)
    ? (row: AnyRow) => String(row.id)
    : undefined

  const scopeOverrides: { tenantId?: string } = {}
  if (tenantId !== undefined && tenantId !== null) {
    scopeOverrides.tenantId = String(tenantId)
  }

  const tenantScopes = Array.from(baseCounts.keys())

  let processed = 0
  let lastId: string | null = null

  options?.onProgress?.({ processed, total, chunkSize: 0 })

  if (resetCoverage) {
    const nowTs = Date.now()
    for (const [tenantValue, count] of baseCounts) {
      const key = `${entityType}|${scopeKey(tenantValue)}`
      const last = lastCoverageReset.get(key) ?? 0
      if (force || nowTs - last >= COVERAGE_REFRESH_THROTTLE_MS) {
        await writeCoverageCounts(em, {
          entityType,
          tenantId: tenantValue,
          organizationId: null,
          withDeleted: false,
        }, { baseCount: count, indexedCount: 0 })
        lastCoverageReset.set(key, nowTs)
      }
    }
  }

  try {
    if (usingPartitions && partitionIndex !== null) {
      await purgeStalePartitionIndexes(knex, {
        entityType,
        table,
        tenantId: tenantId ?? null,
        partitionIndex,
        partitionCount: partitionCountRaw,
      })
    }
    while (true) {
      let query = knex({ b: table })
        .modify(baseWhere)
        .select('b.*')
        .orderBy('b.id', 'asc')
        .limit(batchSize)
      if (lastId !== null) {
        query = query.where('b.id', '>', lastId)
      }
      const rows = await query as AnyRow[]
      if (!rows.length) break

      await upsertIndexBatch(knex, entityType, rows, scopeOverrides, { deriveOrganizationId: deriveOrg })

      const coverageDeltas = new Map<string, { tenantId: string | null; delta: number }>()
      for (const row of rows) {
        const scopeTenant = tenantId !== undefined
          ? tenantId ?? null
          : (hasTenantCol ? ((row as AnyRow).tenant_id ?? null) : null)
        const key = `${scopeTenant ?? '__null__'}`
        const existingDelta = coverageDeltas.get(key)
        if (existingDelta) existingDelta.delta += 1
        else coverageDeltas.set(key, { tenantId: scopeTenant ?? null, delta: 1 })
      }
      if (coverageDeltas.size > 0) {
        await applyCoverageAdjustments(
          em,
          Array.from(coverageDeltas.values()).map((entry) => ({
            entityType,
            tenantId: entry.tenantId,
            organizationId: null,
            withDeleted: false,
            deltaBase: 0,
            deltaIndex: entry.delta,
          })),
        )
      }

      if (emitVectorize && eventBus) {
        await Promise.all(
          rows.map((row) => {
            const scopeOrg = hasOrgCol
              ? ((row as AnyRow).organization_id ?? null)
              : (deriveOrg ? deriveOrg(row) : null)
            const scopeTenant = tenantId !== undefined
              ? tenantId ?? null
              : (hasTenantCol ? ((row as AnyRow).tenant_id ?? null) : null)
            return eventBus
              .emitEvent('query_index.vectorize_one', {
                entityType,
                recordId: String(row.id),
                organizationId: scopeOrg,
                tenantId: scopeTenant,
              })
              .catch(() => undefined)
          }),
        )
      }

      processed += rows.length
      lastId = String(rows[rows.length - 1]!.id)
      options?.onProgress?.({ processed, total, chunkSize: rows.length })
      await updateJobProgress(knex, jobScope, rows.length)
    }

    await purgeUnprocessedPartitionIndexes(knex, {
      entityType,
      tenantId: tenantId ?? null,
      partitionIndex: usingPartitions ? partitionIndex : null,
      partitionCount: usingPartitions ? partitionCountRaw : null,
      startedAt: jobStartedAt,
    })

    for (const tenantValue of tenantScopes) {
      await refreshCoverageSnapshot(em, {
        entityType,
        tenantId: tenantValue,
        organizationId: null,
        withDeleted: false,
      })
    }
  } finally {
    await finalizeJob(knex, jobScope)
  }

  return {
    processed,
    total,
    tenantScopes,
  }
}
