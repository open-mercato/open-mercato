import { cliLogger } from '@open-mercato/cli/lib/helpers'
const logger = cliLogger.forModule('core')
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
const logger = cliLogger.forModule('core')
import type { EntityManager } from '@mikro-orm/postgresql'
import type { Knex } from 'knex'
const logger = cliLogger.forModule('core')
import { createProgressBar } from '@open-mercato/shared/lib/cli/progress'
import { resolveTenantEncryptionService } from '@open-mercato/shared/lib/encryption/customFieldValues'
const logger = cliLogger.forModule('core')
import { decryptIndexDocForSearch, encryptIndexDocForStorage } from '@open-mercato/shared/lib/encryption/indexDoc'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
const logger = cliLogger.forModule('core')

type ProgressBarHandle = {
const logger = cliLogger.forModule('core')
  update(completed: number): void
  complete(): void
}
import { resolveEntityTableName } from '@open-mercato/shared/lib/query/engine'
const logger = cliLogger.forModule('core')
import { recordIndexerError } from '@open-mercato/shared/lib/indexers/error-log'
import { recordIndexerLog } from '@open-mercato/shared/lib/indexers/status-log'
const logger = cliLogger.forModule('core')
import { upsertIndexBatch, type AnyRow } from './lib/batch'
import { reindexEntity, DEFAULT_REINDEX_PARTITIONS } from './lib/reindexer'
const logger = cliLogger.forModule('core')
import { purgeIndexScope } from './lib/purge'
import { flattenSystemEntityIds } from '@open-mercato/shared/lib/entities/system-entities'
const logger = cliLogger.forModule('core')
import type { VectorIndexService } from '@open-mercato/search/vector'

type ParsedArgs = Record<string, string | boolean>
const logger = cliLogger.forModule('core')

type PartitionProgressInfo = { processed: number; total: number }
const logger = cliLogger.forModule('core')

function isIndexerVerbose(): boolean {
  const parsed = parseBooleanToken(process.env.OM_INDEXER_VERBOSE ?? '')
  return parsed === true
}

function createGroupedProgress(label: string, partitionTargets: number[]) {
  const totals = new Map<number, number>()
  const processed = new Map<number, number>()
  let bar: ProgressBarHandle | null = null

  const getTotals = () => {
    let total = 0
    let done = 0
    for (const value of totals.values()) total += value
    for (const value of processed.values()) done += value
    return { total, done }
  }

  const tryInitBar = () => {
    if (bar) return
    if (totals.size < partitionTargets.length) return
    const { total } = getTotals()
    if (total <= 0) return
    bar = createProgressBar(label, total) as ProgressBarHandle
  }

  return {
    onProgress(partition: number, info: PartitionProgressInfo) {
      processed.set(partition, info.processed)
      if (!totals.has(partition)) totals.set(partition, info.total)
      tryInitBar()
      if (!bar) return
      const { done } = getTotals()
      bar.update(done)
    },
    complete() {
      if (bar) bar.complete()
    },
    getTotals,
  }
}

function parseArgs(rest: string[]): ParsedArgs {
  const args: ParsedArgs = {}
  for (let i = 0; i < rest.length; i += 1) {
    const part = rest[i]
    if (!part?.startsWith('--')) continue
    const [rawKey, rawValue] = part.slice(2).split('=')
    if (!rawKey) continue
    if (rawValue !== undefined) {
      args[rawKey] = rawValue
    } else if (i + 1 < rest.length && !rest[i + 1]!.startsWith('--')) {
      args[rawKey] = rest[i + 1]!
      i += 1
    } else {
      args[rawKey] = true
    }
  }
  return args
}

function stringOption(args: ParsedArgs, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const raw = args[key]
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (trimmed.length > 0) return trimmed
  }
  return undefined
}

function numberOption(args: ParsedArgs, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const raw = args[key]
    if (typeof raw === 'number') return raw
    if (typeof raw === 'string') {
      const parsed = Number(raw)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return undefined
}

function flagEnabled(args: ParsedArgs, ...keys: string[]): boolean {
  for (const key of keys) {
    const raw = args[key]
    if (raw === undefined) continue
    if (raw === true) return true
    if (raw === false) continue
    if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (!trimmed) return true
      const parsed = parseBooleanToken(trimmed)
      return parsed === null ? true : parsed
    }
  }
  return false
}

function toPositiveInt(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  const n = Math.floor(value)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return n
}

function toNonNegativeInt(value: number | undefined, fallback = 0): number {
  if (value === undefined) return fallback
  const n = Math.floor(value)
  if (!Number.isFinite(n) || n < 0) return fallback
  return n
}

const DEFAULT_BATCH_SIZE = 200
const logger = cliLogger.forModule('core')

type RebuildExecutionOptions = {
const logger = cliLogger.forModule('core')
  em: EntityManager
  knex: Knex
  entityType: string
  tableName: string
  orgOverride?: string
  tenantOverride?: string
  global: boolean
  includeDeleted: boolean
  limit?: number
  offset: number
  recordId?: string
  batchSize: number
  progressLabel?: string
  supportsOrgFilter: boolean
  supportsTenantFilter: boolean
  supportsDeletedFilter: boolean
}

type RebuildResult = {
const logger = cliLogger.forModule('core')
  processed: number
  matched: number
}
async function rebuildEntityIndexes(options: RebuildExecutionOptions): Promise<RebuildResult> {
  const {
    em,
    knex,
    entityType,
    tableName,
    orgOverride,
    tenantOverride,
    global,
    includeDeleted,
    limit,
    offset,
    recordId,
    batchSize,
    progressLabel,
    supportsOrgFilter,
    supportsTenantFilter,
    supportsDeletedFilter,
  } = options

  const encryption = resolveTenantEncryptionService(em as any)
  const dekKeyCache = new Map<string | null, string | null>()

  const encryptDoc = async (
    targetEntity: string,
    doc: Record<string, unknown>,
    scope: { organizationId: string | null; tenantId: string | null },
  ) => {
    try {
      return await encryptIndexDocForStorage(
        targetEntity,
        doc,
        { tenantId: scope.tenantId ?? null, organizationId: scope.organizationId ?? null },
        encryption,
      )
    } catch {
      return doc
    }
  }

  const decryptDoc = async (
    targetEntity: string,
    doc: Record<string, unknown>,
    scope: { organizationId: string | null; tenantId: string | null },
  ) => {
    try {
      return await decryptIndexDocForSearch(
        targetEntity,
        doc,
        { tenantId: scope.tenantId ?? null, organizationId: scope.organizationId ?? null },
        encryption,
        dekKeyCache,
      )
    } catch {
      return doc
    }
  }

  const filters: Record<string, unknown> = {}
  if (!global) {
    if (orgOverride !== undefined && supportsOrgFilter) filters.organization_id = orgOverride
    if (tenantOverride !== undefined && supportsTenantFilter) filters.tenant_id = tenantOverride
  }
  if (!includeDeleted && supportsDeletedFilter) filters.deleted_at = null

  const baseQuery = knex(tableName).where(filters)

  if (recordId) {
    const row = await baseQuery.clone().where({ id: recordId }).first<AnyRow>()
    if (!row) return { processed: 0, matched: 0 }
    const bar = createProgressBar(progressLabel ?? `Rebuilding ${entityType}`, 1)
    await upsertIndexBatch(knex, entityType, [row], { orgId: orgOverride, tenantId: tenantOverride }, { encryptDoc, decryptDoc })
    bar.update(1)
    bar.complete()
    return { processed: 1, matched: 1 }
  }

  const countRow = await baseQuery.clone().count<{ count: string }>({ count: '*' }).first()
  const totalRaw = countRow?.count ?? (countRow as any)?.['count(*)']
  const total = totalRaw ? Number(totalRaw) : 0
  const effectiveOffset = Math.max(0, offset)
  const matchedWithoutLimit = Math.max(0, total - effectiveOffset)
  const limitValue = toPositiveInt(limit)
  const intended = limitValue !== undefined ? Math.min(matchedWithoutLimit, limitValue) : matchedWithoutLimit
  if (!Number.isFinite(intended) || intended <= 0) {
    return { processed: 0, matched: 0 }
  }

  const bar = createProgressBar(progressLabel ?? `Rebuilding ${entityType}`, intended)
  let processed = 0
  let cursorOffset = effectiveOffset
  let remaining = limitValue

  while (processed < intended) {
    const chunkLimit = remaining !== undefined ? Math.min(batchSize, remaining) : batchSize
    const chunk = await baseQuery
      .clone()
      .select('*')
      .orderBy('id')
      .limit(chunkLimit)
      .offset(cursorOffset)
    if (!chunk.length) break

    await upsertIndexBatch(knex, entityType, chunk as AnyRow[], {
      orgId: orgOverride,
      tenantId: tenantOverride,
    }, { encryptDoc, decryptDoc })

    processed += chunk.length
    cursorOffset += chunk.length
    if (remaining !== undefined) remaining -= chunk.length
    bar.update(processed)
    if (remaining !== undefined && remaining <= 0) break
  }

  if (processed < intended) {
    bar.update(processed)
  }
  bar.complete()
  return { processed, matched: intended }
}

async function getColumnSet(knex: Knex, tableName: string): Promise<Set<string>> {
  try {
    const info = await knex(tableName).columnInfo()
    return new Set(Object.keys(info).map((key) => key.toLowerCase()))
  } catch {
    return new Set<string>()
  }
}

type ScopeDescriptor = {
const logger = cliLogger.forModule('core')
  global: boolean
  orgId?: string
  tenantId?: string
  includeDeleted: boolean
  supportsOrg: boolean
  supportsTenant: boolean
  supportsDeleted: boolean
}

function describeScope(scope: ScopeDescriptor): string {
  const parts: string[] = []
  if (scope.global) parts.push('global')
  if (!scope.global && scope.orgId && scope.supportsOrg) parts.push(`org=${scope.orgId}`)
  if (!scope.global && scope.tenantId && scope.supportsTenant) parts.push(`tenant=${scope.tenantId}`)
  if (!scope.includeDeleted && scope.supportsDeleted) parts.push('active-only')
  return parts.length ? ` (${parts.join(' ')})` : ''
}

const rebuild: ModuleCli = {
const logger = cliLogger.forModule('core')
  command: 'rebuild',
  async run(rest) {
    const args = parseArgs(rest)
    const entity = stringOption(args, 'entity', 'e')
    if (!entity) {
      logger.error(
        'Usage: mercato query_index rebuild --entity <module:entity> [--record <id>] [--org <id>] [--tenant <id>] [--global] [--withDeleted] [--limit <n>] [--offset <n>]',
      )
      return
    }

    const globalFlag = flagEnabled(args, 'global')
    const includeDeleted = flagEnabled(args, 'withDeleted')
    const orgId = stringOption(args, 'org', 'organizationId')
    const tenantId = stringOption(args, 'tenant', 'tenantId')
    const recordId = stringOption(args, 'record', 'recordId', 'id')
    const limit = toPositiveInt(numberOption(args, 'limit'))
    const offset = toNonNegativeInt(numberOption(args, 'offset'))
    const batchSize = toPositiveInt(numberOption(args, 'batch', 'chunk', 'size')) ?? DEFAULT_BATCH_SIZE

    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager)
    try {
      const knex = em.getConnection().getKnex()
      const tableName = resolveEntityTableName(em, entity)
      const columns = await getColumnSet(knex, tableName)
      const supportsOrg = columns.has('organization_id')
      const supportsTenant = columns.has('tenant_id')
      const supportsDeleted = columns.has('deleted_at')

      if (!globalFlag && orgId && !supportsOrg) {
        logger.warn(`[query_index] ${entity} does not expose organization_id, ignoring --org filter`)
      }
      if (!globalFlag && tenantId && !supportsTenant) {
        logger.warn(`[query_index] ${entity} does not expose tenant_id, ignoring --tenant filter`)
      }
      if (!includeDeleted && !supportsDeleted) {
        logger.warn(`[query_index] ${entity} does not expose deleted_at, cannot skip deleted rows`)
      }

      const result = await rebuildEntityIndexes({
        em,
        knex,
        entityType: entity,
        tableName,
        orgOverride: orgId,
        tenantOverride: tenantId,
        global: globalFlag,
        includeDeleted,
        limit,
        offset,
        recordId,
        batchSize,
        progressLabel: recordId ? `Rebuilding ${entity} record ${recordId}` : `Rebuilding ${entity}`,
        supportsOrgFilter: supportsOrg,
        supportsTenantFilter: supportsTenant,
        supportsDeletedFilter: supportsDeleted,
      })

      if (recordId) {
        if (result.processed === 0) {
          logger.info(`No matching row found for ${entity} with id ${recordId}`)
        } else {
          logger.info(`Rebuilt index for ${entity} record ${recordId}`)
        }
        return
      }

      const scopeLabel = describeScope({
        global: globalFlag,
        orgId,
        tenantId,
        includeDeleted,
        supportsOrg,
        supportsTenant,
        supportsDeleted,
      })

      if (result.matched === 0) {
        logger.info(`No rows matched filters for ${entity}${scopeLabel}`)
        return
      }

      logger.info(`Rebuilt ${result.processed} row(s) for ${entity}${scopeLabel}`)
    } catch (error) {
      await recordIndexerError(
        { em },
        {
          source: 'query_index',
          handler: 'cli:query_index.rebuild',
          error,
          entityType: entity,
          recordId,
          tenantId,
          organizationId: orgId,
          payload: { args },
        },
      )
      throw error
    } finally {
      if (typeof (container as any)?.dispose === 'function') {
        await (container as any).dispose()
      }
    }
  },
}

const rebuildAll: ModuleCli = {
const logger = cliLogger.forModule('core')
  command: 'rebuild-all',
  async run(rest) {
    const args = parseArgs(rest)
    const globalFlag = flagEnabled(args, 'global')
    const includeDeleted = flagEnabled(args, 'withDeleted')
    const orgId = stringOption(args, 'org', 'organizationId')
    const tenantId = stringOption(args, 'tenant', 'tenantId')
    const limit = toPositiveInt(numberOption(args, 'limit'))
    const offset = toNonNegativeInt(numberOption(args, 'offset'))
    const batchSize = toPositiveInt(numberOption(args, 'batch', 'chunk', 'size')) ?? DEFAULT_BATCH_SIZE
    const recordId = stringOption(args, 'record', 'recordId', 'id')
    if (recordId) {
      logger.error('`rebuild-all` does not support --record. Use `mercato query_index rebuild --record <id>` instead.')
      return
    }

    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager)
    try {
      const knex = em.getConnection().getKnex()

      const { getEntityIds } = await import('@open-mercato/shared/lib/encryption/entityIds')
      const entityIds = flattenSystemEntityIds(getEntityIds() as Record<string, Record<string, string>>)
      if (!entityIds.length) {
        logger.info('No entity definitions registered for query indexing.')
        return
      }

      let totalProcessed = 0
      for (let idx = 0; idx < entityIds.length; idx += 1) {
        const entity = entityIds[idx]!
        const tableName = resolveEntityTableName(em, entity)
        const columns = await getColumnSet(knex, tableName)
        const supportsOrg = columns.has('organization_id')
        const supportsTenant = columns.has('tenant_id')
        const supportsDeleted = columns.has('deleted_at')

        if (!globalFlag && orgId && !supportsOrg) {
          logger.warn(`[query_index] ${entity} does not expose organization_id, ignoring --org filter`)
        }
        if (!globalFlag && tenantId && !supportsTenant) {
          logger.warn(`[query_index] ${entity} does not expose tenant_id, ignoring --tenant filter`)
        }
        if (!includeDeleted && !supportsDeleted) {
          logger.warn(`[query_index] ${entity} does not expose deleted_at, cannot skip deleted rows`)
        }

        const scopeLabel = describeScope({
          global: globalFlag,
          orgId,
          tenantId,
          includeDeleted,
          supportsOrg,
          supportsTenant,
          supportsDeleted,
        })

        logger.info(`[${idx + 1}/${entityIds.length}] Rebuilding ${entity}${scopeLabel}`)
        const result = await rebuildEntityIndexes({
          em,
          knex,
          entityType: entity,
          tableName,
          orgOverride: orgId,
          tenantOverride: tenantId,
          global: globalFlag,
          includeDeleted,
          limit,
          offset,
          batchSize,
          supportsOrgFilter: supportsOrg,
          supportsTenantFilter: supportsTenant,
          supportsDeletedFilter: supportsDeleted,
        })
        totalProcessed += result.processed
        if (result.matched === 0) {
          logger.info('  -> no rows matched filters')
        } else {
          logger.info(`  -> processed ${result.processed} row(s)`)
        }
      }

      logger.info(`Finished rebuilding all query indexes (processed ${totalProcessed} row(s))`)
    } catch (error) {
      await recordIndexerError(
        { em },
        {
          source: 'query_index',
          handler: 'cli:query_index.rebuild-all',
          error,
          tenantId,
          organizationId: orgId,
          payload: { args },
        },
      )
      throw error
    } finally {
      if (typeof (container as any)?.dispose === 'function') {
        await (container as any).dispose()
      }
    }
  },
}

const reindex: ModuleCli = {
const logger = cliLogger.forModule('core')
  command: 'reindex',
  async run(rest) {
    const args = parseArgs(rest)
    const entity = stringOption(args, 'entity', 'e')
    const orgId = stringOption(args, 'org', 'organizationId')
    const tenantId = stringOption(args, 'tenant', 'tenantId')
    const force = flagEnabled(args, 'force', 'full')
    const batchSize = toPositiveInt(numberOption(args, 'batch', 'chunk', 'size'))
    const partitionsOption = toPositiveInt(numberOption(args, 'partitions', 'partitionCount', 'parallel'))
    const partitionIndexOptionRaw = numberOption(args, 'partition', 'partitionIndex')
    const resetCoverageFlag = flagEnabled(args, 'resetCoverage')
    const skipResetCoverageFlag = flagEnabled(args, 'skipResetCoverage', 'noResetCoverage')
    const skipPurge = flagEnabled(args, 'skipPurge', 'noPurge')

    const container = await createRequestContainer()
    const baseEm = (container.resolve('em') as EntityManager)
    const partitionIndexOption =
      partitionIndexOptionRaw === undefined ? undefined : toNonNegativeInt(partitionIndexOptionRaw, 0)
    const partitionCount = Math.max(
      1,
      partitionsOption ?? DEFAULT_REINDEX_PARTITIONS,
    )

    if (partitionIndexOption !== undefined && partitionIndexOption >= partitionCount) {
      logger.error(`partitionIndex (${partitionIndexOption}) must be < partitionCount (${partitionCount})`)
      if (typeof (container as any)?.dispose === 'function') {
        await (container as any).dispose()
      }
      return
    }

    const partitionTargets =
      partitionIndexOption !== undefined
        ? [partitionIndexOption]
        : Array.from({ length: partitionCount }, (_, idx) => idx)

    const shouldResetCoverage = (partition: number): boolean => {
      if (resetCoverageFlag) return true
      if (skipResetCoverageFlag) return false
      if (partitionIndexOption !== undefined) return partitionIndexOption === 0
      return partition === partitionTargets[0]
    }

    try {
      if (entity) {
        await recordIndexerLog(
          { em: baseEm },
          {
            source: 'query_index',
            handler: 'cli:query_index.reindex',
            message: `Reindex started for ${entity}`,
            entityType: entity,
            tenantId: tenantId ?? null,
            organizationId: orgId ?? null,
            details: {
              force,
              partitions: partitionTargets.length,
              partitionCount,
              partitionIndex: partitionIndexOption ?? null,
              skipPurge,
            },
          },
        ).catch(() => undefined)
        if (!skipPurge) {
          logger.info(`Purging existing index rows for ${entity}...`)
          await purgeIndexScope(baseEm, { entityType: entity, organizationId: orgId, tenantId })
        }
        logger.info(`Reindexing ${entity}${force ? ' (forced)' : ''} in ${partitionTargets.length} partition(s)...`)
        const verbose = isIndexerVerbose()
        const progressState = verbose ? new Map<number, { last: number }>() : null
        const groupedProgress =
          !verbose && partitionTargets.length > 1
            ? createGroupedProgress(`Reindexing ${entity}`, partitionTargets)
            : null
        const renderProgress = (part: number, entityId: string, info: PartitionProgressInfo) => {
          if (!progressState) return
          const state = progressState.get(part) ?? { last: 0 }
          const now = Date.now()
          if (now - state.last < 1000 && info.processed < info.total) return
          state.last = now
          progressState.set(part, state)
          const percent = info.total > 0 ? ((info.processed / info.total) * 100).toFixed(2) : '0.00'
          logger.info(
            `     [${entityId}] partition ${part + 1}/${partitionCount}: ${info.processed.toLocaleString()} / ${info.total.toLocaleString()} (${percent}%)`,
          )
        }

        const stats = await Promise.all(
          partitionTargets.map(async (part, idx) => {
            const label = partitionTargets.length > 1 ? ` [partition ${part + 1}/${partitionCount}]` : ''
            if (partitionTargets.length === 1) {
              logger.info(`  -> processing${label}`)
            } else if (verbose && idx === 0) {
              logger.info(`  -> processing partitions in parallel (count=${partitionTargets.length})`)
            }
            const partitionContainer = await createRequestContainer()
            const partitionEm = partitionContainer.resolve<EntityManager>('em')
            let partitionVectorService: VectorIndexService | null = null
            try {
              partitionVectorService = partitionContainer.resolve<VectorIndexService>('vectorIndexService')
            } catch {
              partitionVectorService = null
            }
            try {
              let progressBar: ProgressBarHandle | null = null
              const useBar = partitionTargets.length === 1
              const partitionStats = await reindexEntity(partitionEm, {
                entityType: entity,
                tenantId,
                organizationId: orgId,
                force,
                batchSize,
                emitVectorizeEvents: false,
                partitionCount,
                partitionIndex: part,
                resetCoverage: shouldResetCoverage(part),
                vectorService: partitionVectorService,
                onProgress(info) {
                  if (useBar) {
                    if (info.total > 0 && !progressBar) {
                      progressBar = createProgressBar(
                        `Reindexing ${entity}${label}`,
                        info.total,
                      ) as ProgressBarHandle
                    }
                    progressBar?.update(info.processed)
                  } else if (groupedProgress) {
                    groupedProgress.onProgress(part, info)
                  } else {
                    renderProgress(part, entity, info)
                  }
                },
              })
              if (progressBar) {
                (progressBar as ProgressBarHandle).complete()
              }
              if (!useBar && groupedProgress) {
                groupedProgress.onProgress(part, { processed: partitionStats.processed, total: partitionStats.total })
              } else if (!useBar) {
                renderProgress(part, entity, { processed: partitionStats.processed, total: partitionStats.total })
              } else {
                logger.info(
                  `     processed ${partitionStats.processed} row(s)${partitionStats.total ? ` (base ${partitionStats.total})` : ''}`,
                )
              }
              return partitionStats.processed
            } finally {
              if (typeof (partitionContainer as any)?.dispose === 'function') {
                await (partitionContainer as any).dispose()
              }
            }
          }),
        )
        groupedProgress?.complete()
        const totalProcessed = stats.reduce((acc, value) => acc + value, 0)
        logger.info(`Finished ${entity}: processed ${totalProcessed} row(s) across ${partitionTargets.length} partition(s)`)
        await recordIndexerLog(
          { em: baseEm },
          {
            source: 'query_index',
            handler: 'cli:query_index.reindex',
            message: `Reindex completed for ${entity}`,
            entityType: entity,
            tenantId: tenantId ?? null,
            organizationId: orgId ?? null,
            details: {
              processed: totalProcessed,
              partitions: partitionTargets.length,
              partitionCount,
              partitionIndex: partitionIndexOption ?? null,
            },
          },
        ).catch(() => undefined)
        return
      }

      const { getEntityIds } = await import('@open-mercato/shared/lib/encryption/entityIds')
      const entityIds = flattenSystemEntityIds(getEntityIds() as Record<string, Record<string, string>>)
      if (!entityIds.length) {
        logger.info('No entity definitions registered for query indexing.')
        return
      }
      for (let idx = 0; idx < entityIds.length; idx += 1) {
        const id = entityIds[idx]!
        await recordIndexerLog(
          { em: baseEm },
          {
            source: 'query_index',
            handler: 'cli:query_index.reindex',
            message: `Reindex started for ${id}`,
            entityType: id,
            tenantId: tenantId ?? null,
            organizationId: orgId ?? null,
            details: {
              force,
              partitions: partitionTargets.length,
              partitionCount,
              partitionIndex: partitionIndexOption ?? null,
              skipPurge,
            },
          },
        ).catch(() => undefined)
        if (!skipPurge) {
          logger.info(`[${idx + 1}/${entityIds.length}] Purging existing index rows for ${id}...`)
          await purgeIndexScope(baseEm, { entityType: id, organizationId: orgId, tenantId })
        }
        logger.info(
          `[${idx + 1}/${entityIds.length}] Reindexing ${id}${force ? ' (forced)' : ''} in ${partitionTargets.length} partition(s)...`,
        )
        const verbose = isIndexerVerbose()
        const progressState = verbose ? new Map<number, { last: number }>() : null
        const groupedProgress =
          !verbose && partitionTargets.length > 1
            ? createGroupedProgress(`Reindexing ${id}`, partitionTargets)
            : null
        const renderProgress = (part: number, entityId: string, info: PartitionProgressInfo) => {
          if (!progressState) return
          const state = progressState.get(part) ?? { last: 0 }
          const now = Date.now()
          if (now - state.last < 1000 && info.processed < info.total) return
          state.last = now
          progressState.set(part, state)
          const percent = info.total > 0 ? ((info.processed / info.total) * 100).toFixed(2) : '0.00'
          logger.info(
            `     [${entityId}] partition ${part + 1}/${partitionCount}: ${info.processed.toLocaleString()} / ${info.total.toLocaleString()} (${percent}%)`,
          )
        }

        const partitionResults = await Promise.all(
          partitionTargets.map(async (part, partitionIdx) => {
            const label = partitionTargets.length > 1 ? ` [partition ${part + 1}/${partitionCount}]` : ''
            if (partitionTargets.length === 1) {
              logger.info(`  -> processing${label}`)
            } else if (verbose && partitionIdx === 0) {
              logger.info(`  -> processing partitions in parallel (count=${partitionTargets.length})`)
            }
            const partitionContainer = await createRequestContainer()
            const partitionEm = partitionContainer.resolve<EntityManager>('em')
            let partitionVectorService: VectorIndexService | null = null
            try {
              partitionVectorService = partitionContainer.resolve<VectorIndexService>('vectorIndexService')
            } catch {
              partitionVectorService = null
            }
            try {
              let progressBar: ProgressBarHandle | null = null
              const useBar = partitionTargets.length === 1
              const result = await reindexEntity(partitionEm, {
                entityType: id,
                tenantId,
                organizationId: orgId,
                force,
                batchSize,
                emitVectorizeEvents: false,
                partitionCount,
                partitionIndex: part,
                resetCoverage: shouldResetCoverage(part),
                vectorService: partitionVectorService,
                onProgress(info) {
                  if (useBar) {
                    if (info.total > 0 && !progressBar) {
                      progressBar = createProgressBar(`Reindexing ${id}${label}`, info.total) as ProgressBarHandle
                    }
                    progressBar?.update(info.processed)
                  } else if (groupedProgress) {
                    groupedProgress.onProgress(part, info)
                  } else {
                    renderProgress(part, id, info)
                  }
                },
              })
              if (progressBar) {
                (progressBar as ProgressBarHandle).complete()
              }
              if (!useBar && groupedProgress) {
                groupedProgress.onProgress(part, { processed: result.processed, total: result.total })
              } else if (!useBar) {
                renderProgress(part, id, { processed: result.processed, total: result.total })
              } else {
                logger.info(
                  `     processed ${result.processed} row(s)${result.total ? ` (base ${result.total})` : ''}`,
                )
              }
              return result.processed
            } finally {
              if (typeof (partitionContainer as any)?.dispose === 'function') {
                await (partitionContainer as any).dispose()
              }
            }
          }),
        )
        groupedProgress?.complete()
        const totalProcessed = partitionResults.reduce((acc, value) => acc + value, 0)
        logger.info(`  -> ${id} complete: processed ${totalProcessed} row(s) across ${partitionTargets.length} partition(s)`)
        await recordIndexerLog(
          { em: baseEm },
          {
            source: 'query_index',
            handler: 'cli:query_index.reindex',
            message: `Reindex completed for ${id}`,
            entityType: id,
            tenantId: tenantId ?? null,
            organizationId: orgId ?? null,
            details: {
              processed: totalProcessed,
              partitions: partitionTargets.length,
              partitionCount,
              partitionIndex: partitionIndexOption ?? null,
            },
          },
        ).catch(() => undefined)
      }
      logger.info(`Finished reindexing ${entityIds.length} entities`)
    } catch (error) {
      const targetLabel = entity ?? 'multiple entities'
      await recordIndexerLog(
        { em: baseEm },
        {
          source: 'query_index',
          handler: 'cli:query_index.reindex',
          level: 'warn',
          message: `Reindex failed for ${targetLabel}`,
          entityType: entity ?? null,
          tenantId: tenantId ?? null,
          organizationId: orgId ?? null,
          details: {
            error: error instanceof Error ? error.message : String(error),
          },
        },
      ).catch(() => undefined)
      await recordIndexerError(
        { em: baseEm },
        {
          source: 'query_index',
          handler: 'cli:query_index.reindex',
          error,
          entityType: entity ?? null,
          tenantId,
          organizationId: orgId ?? null,
          payload: {
            args,
            partitionTargets,
            partitionCount,
            partitionIndex: partitionIndexOption,
            force,
            skipPurge,
          },
        },
      )
      throw error
    } finally {
      if (typeof (container as any)?.dispose === 'function') {
        await (container as any).dispose()
      }
    }
  },
}

const purge: ModuleCli = {
const logger = cliLogger.forModule('core')
  command: 'purge',
  async run(rest) {
    const args = parseArgs(rest)
    const entity = stringOption(args, 'entity', 'e')
    const orgId = stringOption(args, 'org', 'organizationId')
    const tenantId = stringOption(args, 'tenant', 'tenantId')

    const container = await createRequestContainer()
    let em: EntityManager | null = null
    try {
      em = (container.resolve('em') as EntityManager)
    } catch {
      em = null
    }

    try {
      const bus = container.resolve('eventBus') as {
        emitEvent(event: string, payload: any, options?: any): Promise<void>
      }
      if (entity) {
        await bus.emitEvent(
          'query_index.purge',
          { entityType: entity, organizationId: orgId, tenantId },
          { persistent: true },
        )
        await recordIndexerLog(
          { em: em ?? undefined },
          {
            source: 'query_index',
            handler: 'cli:query_index.purge',
            message: `Purge requested for ${entity}`,
            entityType: entity,
            tenantId: tenantId ?? null,
            organizationId: orgId ?? null,
          },
        ).catch(() => undefined)
        logger.info(`Scheduled purge for ${entity}`)
        return
      }

      const { getEntityIds } = await import('@open-mercato/shared/lib/encryption/entityIds')
      const entityIds = flattenSystemEntityIds(getEntityIds() as Record<string, Record<string, string>>)
      for (const id of entityIds) {
        await bus.emitEvent(
          'query_index.purge',
          { entityType: id, organizationId: orgId, tenantId },
          { persistent: true },
        )
        await recordIndexerLog(
          { em: em ?? undefined },
          {
            source: 'query_index',
            handler: 'cli:query_index.purge',
            message: `Purge requested for ${id}`,
            entityType: id,
            tenantId: tenantId ?? null,
            organizationId: orgId ?? null,
            details: { mode: 'bulk' },
          },
        ).catch(() => undefined)
      }
      logger.info(`Scheduled purge for ${entityIds.length} entities`)
    } catch (error) {
      await recordIndexerLog(
        { em: em ?? undefined },
        {
          source: 'query_index',
          handler: 'cli:query_index.purge',
          level: 'warn',
          message: `Purge scheduling failed${entity ? ` for ${entity}` : ''}`,
          entityType: entity ?? null,
          tenantId: tenantId ?? null,
          organizationId: orgId ?? null,
          details: { error: error instanceof Error ? error.message : String(error) },
        },
      ).catch(() => undefined)
      await recordIndexerError(
        { em: em ?? undefined },
        {
          source: 'query_index',
          handler: 'cli:query_index.purge',
          error,
          entityType: entity ?? null,
          tenantId,
          organizationId: orgId,
          payload: { args },
        },
      )
      throw error
    } finally {
      if (typeof (container as any)?.dispose === 'function') {
        await (container as any).dispose()
      }
    }
  },
}

export default [rebuild, rebuildAll, reindex, purge]
