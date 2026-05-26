import type { EntityManager } from '@mikro-orm/postgresql'
import { type Kysely, sql } from 'kysely'
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
  db: Kysely<any>,
  options: {
    entityType: string
    organizationId: string | null
    tenantId: string | null
    activePartitionCount: number | null
  },
): Promise<void> {
  await db
    .deleteFrom('entity_index_jobs' as any)
    .where('entity_type' as any, '=', options.entityType)
    .where(sql<boolean>`organization_id is not distinct from ${options.organizationId}`)
    .where(sql<boolean>`tenant_id is not distinct from ${options.tenantId}`)
    .where(sql<boolean>`partition_count is distinct from ${options.activePartitionCount}`)
    .execute()
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

async function getColumnSet(db: Kysely<any>, tableName: string): Promise<Set<string>> {
  try {
    const rows = await db
      .selectFrom('information_schema.columns' as any)
      .select(['column_name' as any])
      .where(sql<boolean>`table_schema = current_schema()`)
      .where('table_name' as any, '=', tableName)
      .execute() as Array<{ column_name: string }>
    return new Set(rows.map((row) => String(row.column_name).toLowerCase()))
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

  const db = (em as any).getKysely() as Kysely<any>
  const table = resolveEntityTableName(em, entityType)
  if (entityType === 'query_index:search_token' || table === 'search_tokens') {
    return {
      processed: 0,
      total: 0,
      tenantScopes: [],
      scopes: [],
    }
  }
  const columns = await getColumnSet(db, table)
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
    const activeJob = await db
      .selectFrom('entity_index_jobs' as any)
      .select(['id' as any])
      .where('entity_type' as any, '=', entityType)
      .where('finished_at' as any, 'is', null as any)
      .where(sql<boolean>`organization_id is not distinct from ${null}`)
      .where(sql<boolean>`tenant_id is not distinct from ${tenantId ?? null}`)
      .where(sql<boolean>`partition_index is not distinct from ${partitionIndex}`)
      .where(sql<boolean>`partition_count is not distinct from ${usingPartitions ? partitionCountRaw : null}`)
      .executeTakeFirst()
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
    await cleanupLegacyJobScopes(db, {
      entityType,
      organizationId: jobScope.organizationId ?? null,
      tenantId: jobScope.tenantId ?? null,
      activePartitionCount: jobScope.partitionCount ?? null,
    })
  }

  const scopeKey = (tenantValue: string | null, orgValue: string | null) => `${tenantValue ?? '__null__'}|${orgValue ?? '__null__'}`

  const applyBaseWhere = <QB extends { where: (...args: any[]) => QB }>(q: QB): QB => {
    let chain = q
    if (hasDeletedCol) chain = chain.where('b.deleted_at' as any, 'is', null as any)
    if (tenantId !== undefined && hasTenantCol) {
      chain = tenantId === null
        ? chain.where('b.tenant_id' as any, 'is', null as any)
        : chain.where('b.tenant_id' as any, '=', tenantId)
    }
    if (organizationId !== undefined && hasOrgCol) {
      chain = organizationId === null
        ? chain.where('b.organization_id' as any, 'is', null as any)
        : chain.where('b.organization_id' as any, '=', organizationId)
    }
    if (usingPartitions && partitionIndex !== null) {
      chain = chain.where(sql<boolean>`mod(abs(hashtext(b.id::text)), ${partitionCountRaw}) = ${partitionIndex}`)
    }
    return chain
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
    let groupQuery = applyBaseWhere(
      db.selectFrom(`${table} as b` as any).select(sql<number>`count(*)`.as('count')),
    )
    if (groupByTenant) {
      groupQuery = groupQuery.select('b.tenant_id as tenant_id' as any).groupBy('b.tenant_id' as any)
    }
    if (groupByOrg) {
      groupQuery = groupQuery.select('b.organization_id as organization_id' as any).groupBy('b.organization_id' as any)
    }
    const rows = await groupQuery.execute() as Array<Record<string, unknown>>
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
    const row = await applyBaseWhere(
      db.selectFrom(`${table} as b` as any).select(sql<number>`count(*)`.as('count')),
    ).executeTakeFirst() as { count: unknown } | undefined
    const bucketTenant = tenantId === undefined ? null : tenantId ?? null
    const bucketOrg = organizationId === undefined ? null : organizationId ?? null
    registerBaseCount(bucketTenant, bucketOrg, toNumber(row?.count))
  }

  const total = Array.from(baseCounts.values()).reduce((acc, value) => acc + (Number.isFinite(value.count) ? value.count : 0), 0)
  await prepareJob(db, jobScope, 'reindexing', { totalCount: total })
  const jobRow = await db
    .selectFrom('entity_index_jobs' as any)
    .select(['started_at' as any])
    .where('entity_type' as any, '=', entityType)
    .where('organization_id' as any, 'is', null as any)
    .where(sql<boolean>`tenant_id is not distinct from ${tenantId ?? null}`)
    .where(sql<boolean>`partition_index is not distinct from ${partitionIndex}`)
    .where(sql<boolean>`partition_count is not distinct from ${usingPartitions ? partitionCountRaw : null}`)
    .orderBy('started_at' as any, 'desc')
    .executeTakeFirst() as { started_at: Date | string } | undefined
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
      try {
        let purgeQuery = db
          .deleteFrom('entity_indexes' as any)
          .where('entity_type' as any, '=', entityType)
        if (tenantId !== undefined) {
          purgeQuery = purgeQuery.where(sql<boolean>`tenant_id is not distinct from ${tenantId ?? null}`)
        }
        if (organizationId !== undefined) {
          purgeQuery = purgeQuery.where(sql<boolean>`organization_id is not distinct from ${organizationId ?? null}`)
        }
        await purgeQuery.execute()
      } catch (error) {
        console.warn('[HybridQueryEngine] Failed to purge index rows before force reindex', {
          entityType,
          tenantId: tenantId ?? null,
          organizationId: organizationId ?? null,
          error: error instanceof Error ? error.message : error,
        })
      }

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
      let query = applyBaseWhere(
        db
          .selectFrom(`${table} as b` as any)
          .selectAll('b' as any)
          .orderBy('b.id' as any, 'asc')
          .limit(batchSize),
      )
      if (lastId !== null) {
        query = query.where('b.id' as any, '>', lastId)
      }
      const rows = await query.execute() as AnyRow[]
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

      await upsertIndexBatch(db, entityType, rows, scopeOverrides, { deriveOrganizationId: deriveOrg, encryptDoc, decryptDoc })

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
      await updateJobProgress(db, jobScope, rows.length)
    }

    await purgeOrphans(db, {
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
      )
    }
  } finally {
    await finalizeJob(db, jobScope)
  }

  return {
    processed,
    total,
    scopes: scopeEntries,
    tenantScopes,
  }
}
