import type { EntityManager } from '@mikro-orm/postgresql'
import type { Knex } from 'knex'
import { resolveEntityTableName } from '@open-mercato/shared/lib/query/engine'
import { resolveTenantEncryptionService } from '@open-mercato/shared/lib/encryption/customFieldValues'
import { decryptIndexDocForSearch, encryptIndexDocForStorage } from '@open-mercato/shared/lib/encryption/indexDoc'
import { upsertIndexBatch, type AnyRow } from './batch'
import { refreshCoverageSnapshot, writeCoverageCounts, applyCoverageAdjustments } from './coverage'
import { prepareJob, updateJobProgress, finalizeJob, type JobScope } from './jobs'
import { purgeOrphans } from './stale'
import type { VectorIndexService } from '@open-mercato/search/vector'
import { isSearchDebugEnabled } from './search-tokens'

export type ReindexJobOptions = {
  entityType: string
  tenantId?: string | null
  organizationId?: string | null
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
  vectorService?: VectorIndexService | null
}

export type ReindexJobResult = {
  processed: number
  total: number
  tenantScopes: Array<string | null>
  scopes: Array<{ tenantId: string | null; organizationId: string | null }>
}

export const DEFAULT_REINDEX_PARTITIONS = 5
const DEFAULT_BATCH_SIZE = 500
const deriveOrgFromId = new Set<string>(['directory:organization'])
const COVERAGE_REFRESH_THROTTLE_MS = 5 * 60 * 1000
const lastCoverageReset = new Map<string, number>()

async function cleanupLegacyJobScopes(
  knex: Knex,
  options: {
    entityType: string
    organizationId: string | null
    tenantId: string | null
    activePartitionCount: number | null
  },
): Promise<void> {
  await knex('entity_index_jobs')
    .where('entity_type', options.entityType)
    .andWhereRaw('organization_id is not distinct from ?', [options.organizationId])
    .andWhereRaw('tenant_id is not distinct from ?', [options.tenantId])
    .andWhereRaw('partition_count is distinct from ?', [options.activePartitionCount])
    .del()
}

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
  if (!entityType) {
    return {
      processed: 0,
      total: 0,
      tenantScopes: [],
      scopes: [],
    }
  }
  const tenantIdInput = options?.tenantId
  const tenantId = tenantIdInput === 'undefined' ? undefined : tenantIdInput
  const organizationIdInput = options?.organizationId
  const organizationId = organizationIdInput === 'undefined' ? undefined : organizationIdInput
  const force = options?.force === true
  const batchSize = Number.isFinite(options?.batchSize) && options!.batchSize! > 0
    ? Math.max(1, Math.trunc(options!.batchSize!))
    : DEFAULT_BATCH_SIZE
  const emitVectorize = options?.emitVectorizeEvents === true
  const eventBus = options?.eventBus
  const vectorService = options?.vectorService ?? null
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
  if (entityType === 'query_index:search_token' || table === 'search_tokens') {
    return {
      processed: 0,
      total: 0,
      tenantScopes: [],
      scopes: [],
    }
  }
  const columns = await getColumnSet(knex, table)
  const hasOrgCol = columns.has('organization_id')
  const hasTenantCol = columns.has('tenant_id')
  const hasDeletedCol = columns.has('deleted_at')

  const jobScope: JobScope = {
    entityType,
    organizationId: organizationId ?? null,
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
      return {
        processed: 0,
        total: 0,
        tenantScopes: [],
        scopes: [],
      }
    }
  }

  if (resetCoverage) {
    await cleanupLegacyJobScopes(knex, {
      entityType,
      organizationId: jobScope.organizationId ?? null,
      tenantId: jobScope.tenantId ?? null,
      activePartitionCount: jobScope.partitionCount ?? null,
    })
  }

  const scopeKey = (tenantValue: string | null, orgValue: string | null) => `${tenantValue ?? '__null__'}|${orgValue ?? '__null__'}`
  const baseWhere = (builder: Knex.QueryBuilder<any, any>) => {
    if (hasDeletedCol) builder.whereNull('b.deleted_at')
    if (tenantId !== undefined && hasTenantCol) {
      if (tenantId === null) builder.whereNull('b.tenant_id')
      else builder.where('b.tenant_id', tenantId)
    }
    if (organizationId !== undefined && hasOrgCol) {
      if (organizationId === null) builder.whereNull('b.organization_id')
      else builder.where('b.organization_id', organizationId)
    }
    if (usingPartitions && partitionIndex !== null) {
      builder.whereRaw('mod(abs(hashtext(b.id::text)), ?) = ?', [partitionCountRaw, partitionIndex])
    }
  }

  type ScopeStats = { tenantId: string | null; organizationId: string | null; count: number }
  const baseCounts = new Map<string, ScopeStats>()
  const registerBaseCount = (tenantValue: string | null, orgValue: string | null, count: number) => {
    const key = scopeKey(tenantValue, orgValue)
    baseCounts.set(key, { tenantId: tenantValue, organizationId: orgValue, count })
  }

  const groupByTenant = hasTenantCol && tenantId === undefined
  const groupByOrg = hasOrgCol && organizationId === undefined

  if (groupByTenant || groupByOrg) {
    const rows = await knex({ b: table })
      .modify(baseWhere)
      .modify((qb) => {
        if (groupByTenant) qb.select(knex.raw('b.tenant_id as tenant_id'))
        if (groupByOrg) qb.select(knex.raw('b.organization_id as organization_id'))
      })
      .count<{ count: unknown }[]>({ count: '*' })
      .modify((qb) => {
        if (groupByTenant) qb.groupBy('b.tenant_id')
        if (groupByOrg) qb.groupBy('b.organization_id')
      })
    for (const row of rows) {
      const bucketTenant = groupByTenant
        ? ((row as any)?.tenant_id ?? null)
        : (tenantId === undefined ? null : tenantId ?? null)
      const bucketOrg = groupByOrg
        ? ((row as any)?.organization_id ?? null)
        : (organizationId === undefined ? null : organizationId ?? null)
      registerBaseCount(bucketTenant, bucketOrg, toNumber((row as any)?.count))
    }
  } else {
    const row = await knex({ b: table })
      .modify(baseWhere)
      .count({ count: '*' })
      .first()
    const bucketTenant = tenantId === undefined ? null : tenantId ?? null
    const bucketOrg = organizationId === undefined ? null : organizationId ?? null
    registerBaseCount(bucketTenant, bucketOrg, toNumber(row?.count))
  }

  const total = Array.from(baseCounts.values()).reduce((acc, value) => acc + (Number.isFinite(value.count) ? value.count : 0), 0)
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

  const scopeOverrides: { tenantId?: string; orgId?: string } = {}
  if (tenantId !== undefined && tenantId !== null) {
    scopeOverrides.tenantId = String(tenantId)
  }
  if (organizationId !== undefined && organizationId !== null) {
    scopeOverrides.orgId = String(organizationId)
  }

  const scopeEntries = Array.from(baseCounts.values()).map((entry) => ({
    tenantId: entry.tenantId,
    organizationId: entry.organizationId,
  }))
  const tenantScopes = Array.from(
    new Set(scopeEntries.map((entry) => entry.tenantId ?? null)),
  )

  let processed = 0
  let lastId: string | null = null

  options?.onProgress?.({ processed, total, chunkSize: 0 })

  if (resetCoverage) {
    if (force) {
      await knex('entity_indexes')
        .where('entity_type', entityType)
        .modify((qb) => {
          if (tenantId !== undefined) {
            qb.andWhereRaw('tenant_id is not distinct from ?', [tenantId ?? null])
          }
          if (organizationId !== undefined) {
            qb.andWhereRaw('organization_id is not distinct from ?', [organizationId ?? null])
          }
        })
        .del()
        .catch((error) => {
          console.warn('[HybridQueryEngine] Failed to purge index rows before force reindex', {
            entityType,
            tenantId: tenantId ?? null,
            organizationId: organizationId ?? null,
            error: error instanceof Error ? error.message : error,
          })
        })

      if (emitVectorize && eventBus) {
        if (tenantId !== undefined) {
          const payload: Record<string, unknown> = {
            entityType,
            tenantId: tenantId ?? null,
          }
          if (organizationId !== undefined) payload.organizationId = organizationId ?? null
          try {
            await eventBus.emitEvent('query_index.vectorize_purge', payload)
          } catch (err) {
            console.warn('[HybridQueryEngine] Failed to queue vector purge before force reindex', {
              entityType,
              tenantId: tenantId ?? null,
              organizationId: organizationId ?? null,
              error: err instanceof Error ? err.message : err,
            })
          }
        } else {
          console.warn('[HybridQueryEngine] Skipping vector purge for force reindex without tenant scope', {
            entityType,
          })
        }
      }
    }

    const nowTs = Date.now()
    for (const scope of baseCounts.values()) {
      const key = `${entityType}|${scopeKey(scope.tenantId, scope.organizationId)}`
      const last = lastCoverageReset.get(key) ?? 0
      if (force || nowTs - last >= COVERAGE_REFRESH_THROTTLE_MS) {
        await writeCoverageCounts(em, {
          entityType,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          withDeleted: false,
        }, {
          baseCount: scope.count,
          indexedCount: 0,
          vectorCount: emitVectorize ? 0 : undefined,
        })
        lastCoverageReset.set(key, nowTs)
      }
    }
  }

  try {
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

      const encryption = resolveTenantEncryptionService(em as any)
      const dekKeyCache = new Map<string | null, string | null>()
      const encryptDoc = async (
        targetEntity: string,
        doc: Record<string, unknown>,
        scope: { organizationId: string | null; tenantId: string | null },
      ) => {
        return await encryptIndexDocForStorage(
          targetEntity,
          doc,
          { tenantId: scope.tenantId ?? null, organizationId: scope.organizationId ?? null },
          encryption,
        )
      }
      const decryptDoc = async (
        targetEntity: string,
        doc: Record<string, unknown>,
        scope: { organizationId: string | null; tenantId: string | null },
      ) => {
        const result = await decryptIndexDocForSearch(
          targetEntity,
          doc,
          { tenantId: scope.tenantId ?? null, organizationId: scope.organizationId ?? null },
          encryption,
          dekKeyCache,
        )
        if (isSearchDebugEnabled()) {
          const keysOfInterest = ['display_name', 'first_name', 'last_name', 'brand_name', 'legal_name', 'primary_email', 'primary_phone']
          const snapshot: Record<string, unknown> = {}
          for (const key of keysOfInterest) {
            if (key in result) snapshot[key] = (result as Record<string, unknown>)[key]
          }
          console.info('[reindex:decrypt]', {
            entityType: targetEntity,
            tenantId: scope.tenantId ?? null,
            organizationId: scope.organizationId ?? null,
            keys: Object.keys(snapshot),
            sample: snapshot,
          })
        }
        return result
      }

      await upsertIndexBatch(knex, entityType, rows, scopeOverrides, { deriveOrganizationId: deriveOrg, encryptDoc, decryptDoc })

      const coverageDeltas = new Map<string, { tenantId: string | null; organizationId: string | null; delta: number }>()
      for (const row of rows) {
        const scopeTenant = tenantId !== undefined
          ? tenantId ?? null
          : (hasTenantCol ? ((row as AnyRow).tenant_id ?? null) : null)
        const scopeOrg = organizationId !== undefined
          ? organizationId ?? null
          : (hasOrgCol ? ((row as AnyRow).organization_id ?? null) : (deriveOrg ? deriveOrg(row) ?? null : null))
        const key = scopeKey(scopeTenant ?? null, scopeOrg ?? null)
        const existingDelta = coverageDeltas.get(key)
        if (existingDelta) existingDelta.delta += 1
        else coverageDeltas.set(key, {
          tenantId: scopeTenant ?? null,
          organizationId: scopeOrg ?? null,
          delta: 1,
        })
      }
      if (coverageDeltas.size > 0) {
        await applyCoverageAdjustments(
          em,
          Array.from(coverageDeltas.values()).map((entry) => ({
            entityType,
            tenantId: entry.tenantId,
            organizationId: entry.organizationId,
            withDeleted: false,
            deltaBase: 0,
            deltaIndex: entry.delta,
          })),
        )
      }

      if (emitVectorize && eventBus) {
        await Promise.all(
          rows.map((row) => {
            const scopeOrg = organizationId !== undefined
              ? organizationId ?? null
              : hasOrgCol
                ? ((row as AnyRow).organization_id ?? null)
                : (deriveOrg ? deriveOrg(row) ?? null : null)
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

    await purgeOrphans(knex, {
      entityType,
      tenantId,
      organizationId,
      partitionIndex: usingPartitions ? partitionIndex : null,
      partitionCount: usingPartitions ? partitionCountRaw : null,
      startedAt: jobStartedAt,
    })

    if (force && vectorService && (!usingPartitions || partitionIndex === null)) {
      try {
        await vectorService.removeOrphans({
          entityId: entityType,
          tenantId,
          organizationId,
          olderThan: jobStartedAt,
        })
      } catch (error) {
        console.warn('[HybridQueryEngine] Failed to prune vector orphans after reindex', {
          entityType,
          tenantId: tenantId ?? null,
          organizationId: organizationId ?? null,
          error: error instanceof Error ? error.message : error,
        })
      }
    }

    for (const scope of scopeEntries) {
      await refreshCoverageSnapshot(
        em,
        {
          entityType,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          withDeleted: false,
        },
        { vectorService },
      )
    }
  } finally {
    await finalizeJob(knex, jobScope)
  }

  return {
    processed,
    total,
    scopes: scopeEntries,
    tenantScopes,
  }
}
