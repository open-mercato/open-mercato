import { cliLogger } from '@open-mercato/cli/lib/helpers'
const logger = cliLogger.forModule('core')
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
const logger = cliLogger.forModule('core')
import { getRedisUrl } from '@open-mercato/shared/lib/redis/connection'
import { recordIndexerError } from '@open-mercato/shared/lib/indexers/error-log'
const logger = cliLogger.forModule('core')
import { recordIndexerLog } from '@open-mercato/shared/lib/indexers/status-log'
import { createProgressBar } from '@open-mercato/shared/lib/cli/progress'
const logger = cliLogger.forModule('core')
import type { EntityManager } from '@mikro-orm/postgresql'
import { reindexEntity, DEFAULT_REINDEX_PARTITIONS } from '@open-mercato/core/modules/query_index/lib/reindexer'
const logger = cliLogger.forModule('core')
import { writeCoverageCounts } from '@open-mercato/core/modules/query_index/lib/coverage'
import type { SearchService } from '../../service'
const logger = cliLogger.forModule('core')
import type { SearchIndexer } from '../../indexer/search-indexer'
import { VECTOR_INDEXING_QUEUE_NAME, type VectorIndexJobPayload } from '../../queue/vector-indexing'
const logger = cliLogger.forModule('core')
import { FULLTEXT_INDEXING_QUEUE_NAME, type FulltextIndexJobPayload } from '../../queue/fulltext-indexing'
import type { QueuedJob, JobContext } from '@open-mercato/queue'
const logger = cliLogger.forModule('core')
import type { EntityId } from '@open-mercato/shared/modules/entities'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
const logger = cliLogger.forModule('core')

type CliProgressBar = {
const logger = cliLogger.forModule('core')
  update(completed: number): void
  complete(): void
}

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
  let bar: CliProgressBar | null = null

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
    bar = createProgressBar(label, total)
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

function stringOpt(args: ParsedArgs, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const raw = args[key]
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (trimmed.length > 0) return trimmed
  }
  return undefined
}

function numberOpt(args: ParsedArgs, ...keys: string[]): number | undefined {
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

function flagOpt(args: ParsedArgs, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const raw = args[key]
    if (raw === undefined) continue
    if (raw === true) return true
    if (raw === false) return false
    if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (!trimmed) return true
      const parsed = parseBooleanToken(trimmed)
      return parsed === null ? true : parsed
    }
  }
  return undefined
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

/**
 * Test search functionality with a query
 */
async function searchCommand(rest: string[]): Promise<void> {
  const args = parseArgs(rest)
  const query = stringOpt(args, 'query', 'q')
  const tenantId = stringOpt(args, 'tenant', 'tenantId')
  const organizationId = stringOpt(args, 'org', 'organizationId')
  const entityTypes = stringOpt(args, 'entity', 'entities')
  const strategies = stringOpt(args, 'strategy', 'strategies')
  const limit = numberOpt(args, 'limit') ?? 20

  if (!query) {
    logger.error('Usage: yarn mercato search query --query "search terms" --tenant <id> [options]')
    logger.error('  --query, -q       Search query (required)')
    logger.error('  --tenant          Tenant ID (required)')
    logger.error('  --org             Organization ID (optional)')
    logger.error('  --entity          Entity types to search (comma-separated)')
    logger.error('  --strategy        Strategies to use (comma-separated: meilisearch,vector,tokens)')
    logger.error('  --limit           Max results (default: 20)')
    return
  }

  if (!tenantId) {
    logger.error('Error: --tenant is required')
    return
  }

  const container = await createRequestContainer()

  try {
    const searchService = container.resolve('searchService') as SearchService | undefined

    if (!searchService) {
      logger.error('Error: SearchService not available. Make sure the search module is registered.')
      return
    }

    logger.info(`\nSearching for: "${query}"`)
    logger.info(`Tenant: ${tenantId}`)
    if (organizationId) logger.info(`Organization: ${organizationId}`)
    logger.info('---')

    const results = await searchService.search(query, {
      tenantId,
      organizationId,
      entityTypes: entityTypes?.split(',').map(s => s.trim()),
      strategies: strategies?.split(',').map(s => s.trim()) as any,
      limit,
    })

    if (results.length === 0) {
      logger.info('No results found.')
      return
    }

    logger.info(`\nFound ${results.length} result(s):\n`)

    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      logger.info(`${i + 1}. [${result.source}] ${result.entityId}`)
      logger.info(`   Record ID: ${result.recordId}`)
      logger.info(`   Score: ${result.score.toFixed(4)}`)
      if (result.presenter) {
        logger.info(`   Title: ${result.presenter.title}`)
        if (result.presenter.subtitle) logger.info(`   Subtitle: ${result.presenter.subtitle}`)
      }
      if (result.url) logger.info(`   URL: ${result.url}`)
      logger.info('')
    }
  } finally {
    try {
      const em = container.resolve('em') as any
      await em?.getConnection?.()?.close?.()
    } catch {}
  }
}

/**
 * Show status of search strategies
 */
async function statusCommand(): Promise<void> {
  const container = await createRequestContainer()

  try {
    const searchService = container.resolve('searchService') as SearchService | undefined
    const strategies = container.resolve('searchStrategies') as any[] | undefined

    logger.info('\n=== Search Module Status ===\n')

    if (!searchService) {
      logger.info('SearchService: NOT REGISTERED')
      return
    }

    logger.info('SearchService: ACTIVE')
    logger.info('')

    if (!strategies || strategies.length === 0) {
      logger.info('Strategies: NONE CONFIGURED')
      return
    }

    logger.info('Strategies:')
    logger.info('-----------')

    for (const strategy of strategies) {
      const available = await strategy.isAvailable?.() ?? true
      const status = available ? 'AVAILABLE' : 'UNAVAILABLE'
      const icon = available ? '✓' : '✗'
      logger.info(`  ${icon} ${strategy.name ?? strategy.id} (${strategy.id})`)
      logger.info(`    Status: ${status}`)
      logger.info(`    Priority: ${strategy.priority ?? 'N/A'}`)
      logger.info('')
    }

    // Check environment variables
    logger.info('Environment:')
    logger.info('------------')
    logger.info(`  MEILISEARCH_HOST: ${process.env.MEILISEARCH_HOST ?? '(not set)'}`)
    logger.info(`  MEILISEARCH_API_KEY: ${process.env.MEILISEARCH_API_KEY ? '(set)' : '(not set)'}`)
    logger.info(`  OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? '(set)' : '(not set)'}`)
    logger.info(`  OM_SEARCH_ENABLED: ${process.env.OM_SEARCH_ENABLED ?? 'true (default)'}`)
    logger.info('')
  } finally {
    try {
      const em = container.resolve('em') as any
      await em?.getConnection?.()?.close?.()
    } catch {}
  }
}

/**
 * Index a specific record for testing
 */
async function indexCommand(rest: string[]): Promise<void> {
  const args = parseArgs(rest)
  const entityId = stringOpt(args, 'entity', 'entityId')
  const recordId = stringOpt(args, 'record', 'recordId')
  const tenantId = stringOpt(args, 'tenant', 'tenantId')
  const organizationId = stringOpt(args, 'org', 'organizationId')

  if (!entityId || !recordId || !tenantId) {
    logger.error('Usage: yarn mercato search index --entity <entityId> --record <recordId> --tenant <tenantId>')
    logger.error('  --entity          Entity ID (e.g., customers:customer_person_profile)')
    logger.error('  --record          Record ID')
    logger.error('  --tenant          Tenant ID')
    logger.error('  --org             Organization ID (optional)')
    return
  }

  const container = await createRequestContainer()

  try {
    const searchIndexer = container.resolve('searchIndexer') as SearchIndexer | undefined

    if (!searchIndexer) {
      logger.error('Error: SearchIndexer not available.')
      return
    }

    // Load record from query engine
    const queryEngine = container.resolve('queryEngine') as any

    logger.info(`\nLoading record: ${entityId} / ${recordId}`)

    const result = await queryEngine.query(entityId, {
      tenantId,
      organizationId,
      filters: { id: recordId },
      includeCustomFields: true,
      page: { page: 1, pageSize: 1 },
    })

    const record = result.items[0]

    if (!record) {
      logger.error('Error: Record not found')
      return
    }

    logger.info('Record loaded, indexing...')

    // Extract custom fields
    const customFields: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(record)) {
      if (key.startsWith('cf:') || key.startsWith('cf_')) {
        const cfKey = key.slice(3) // Remove 'cf:' or 'cf_' prefix (both are 3 chars)
        customFields[cfKey] = value
      }
    }

    await searchIndexer.indexRecord({
      entityId,
      recordId,
      tenantId,
      organizationId,
      record,
      customFields,
    })

    logger.info('Record indexed successfully!')
  } finally {
    try {
      const em = container.resolve('em') as any
      await em?.getConnection?.()?.close?.()
    } catch {}
  }
}

/**
 * Test Meilisearch connection directly
 */
async function testMeilisearchCommand(): Promise<void> {
  const host = process.env.MEILISEARCH_HOST
  const apiKey = process.env.MEILISEARCH_API_KEY

  logger.info('\n=== Meilisearch Connection Test ===\n')

  if (!host) {
    logger.info('MEILISEARCH_HOST: NOT SET')
    logger.info('\nMeilisearch is not configured. Set MEILISEARCH_HOST in your .env file.')
    return
  }

  logger.info(`Host: ${host}`)
  logger.info(`API Key: ${apiKey ? '(configured)' : '(not set)'}`)
  logger.info('')

  try {
    const { MeiliSearch } = await import('meilisearch')
    const client = new MeiliSearch({ host, apiKey })

    logger.info('Testing connection...')
    const health = await client.health()
    logger.info(`Health: ${health.status}`)

    logger.info('\nListing indexes...')
    const indexes = await client.getIndexes()

    if (indexes.results.length === 0) {
      logger.info('No indexes found.')
    } else {
      logger.info(`Found ${indexes.results.length} index(es):`)
      for (const index of indexes.results) {
        const stats = await client.index(index.uid).getStats()
        logger.info(`  - ${index.uid}: ${stats.numberOfDocuments} documents`)
      }
    }

    logger.info('\nMeilisearch connection successful!')
  } catch (error) {
    logger.error('Connection failed:', error instanceof Error ? error.message : error)
  }
}

const searchCli: ModuleCli = {
const logger = cliLogger.forModule('core')
  command: 'query',
  async run(rest) {
    await searchCommand(rest)
  },
}

const statusCli: ModuleCli = {
const logger = cliLogger.forModule('core')
  command: 'status',
  async run() {
    await statusCommand()
  },
}

const indexCli: ModuleCli = {
const logger = cliLogger.forModule('core')
  command: 'index',
  async run(rest) {
    await indexCommand(rest)
  },
}

const testMeilisearchCli: ModuleCli = {
const logger = cliLogger.forModule('core')
  command: 'test-meilisearch',
  async run() {
    await testMeilisearchCommand()
  },
}

async function resetVectorCoverageAfterPurge(
  em: EntityManager | null,
  entityId: string,
  tenantId: string | null,
  organizationId: string | null,
): Promise<void> {
  if (!em || !entityId) return
  try {
    const scopes = new Set<string>()
    scopes.add('__null__')
    if (organizationId) scopes.add(organizationId)
    for (const scope of scopes) {
      const orgValue = scope === '__null__' ? null : scope
      await writeCoverageCounts(
        em,
        {
          entityType: entityId,
          tenantId,
          organizationId: orgValue,
          withDeleted: false,
        },
        { vectorCount: 0 },
      )
    }
  } catch (error) {
    logger.warn('[search.cli] Failed to reset vector coverage after purge', error instanceof Error ? error.message : error)
  }
}

async function reindexCommand(rest: string[]): Promise<void> {
  const args = parseArgs(rest)
  const tenantId = stringOpt(args, 'tenant', 'tenantId')
  const organizationId = stringOpt(args, 'org', 'orgId', 'organizationId')
  const entityId = stringOpt(args, 'entity', 'entityId')
  const force = flagOpt(args, 'force', 'full') === true
  const batchSize = toPositiveInt(numberOpt(args, 'batch', 'chunk', 'size'))
  const partitionsOption = toPositiveInt(numberOpt(args, 'partitions', 'partitionCount', 'parallel'))
  const partitionIndexRaw = numberOpt(args, 'partition', 'partitionIndex')
  const partitionIndexOption = partitionIndexRaw === undefined ? undefined : toNonNegativeInt(partitionIndexRaw, 0)
  const resetCoverageFlag = flagOpt(args, 'resetCoverage') === true
  const skipResetCoverageFlag = flagOpt(args, 'skipResetCoverage', 'noResetCoverage') === true
  const skipPurgeFlag = flagOpt(args, 'skipPurge', 'noPurge') === true
  const purgeFlag = flagOpt(args, 'purge', 'purgeFirst')

  const container = await createRequestContainer()
  let baseEm: EntityManager | null = null
  try {
    baseEm = (container.resolve('em') as EntityManager)
  } catch {
    baseEm = null
  }

  const disposeContainer = async () => {
    if (typeof (container as any)?.dispose === 'function') {
      await (container as any).dispose()
    }
  }

  const recordError = async (error: Error) => {
    await recordIndexerLog(
      { em: baseEm ?? undefined },
      {
        source: 'vector',
        handler: 'cli:search.reindex',
        level: 'warn',
        message: `Reindex failed${entityId ? ` for ${entityId}` : ''}`,
        entityType: entityId ?? null,
        tenantId: tenantId ?? null,
        organizationId: organizationId ?? null,
        details: { error: error.message },
      },
    ).catch(() => undefined)
    await recordIndexerError(
      { em: baseEm ?? undefined },
      {
        source: 'vector',
        handler: 'cli:search.reindex',
        error,
        entityType: entityId ?? null,
        tenantId: tenantId ?? null,
        organizationId: organizationId ?? null,
        payload: {
          args,
          force,
          batchSize,
          partitionsOption,
          partitionIndexOption,
          resetCoverageFlag,
          skipResetCoverageFlag,
          skipPurgeFlag,
          purgeFlag,
        },
      },
    )
  }

  try {
    const searchIndexer = container.resolve<SearchIndexer>('searchIndexer')
    const enabledEntities = new Set(searchIndexer.listEnabledEntities())
    const baseEventBus = (() => {
      try {
        return container.resolve('eventBus') as {
          emitEvent(event: string, payload: any, options?: any): Promise<void>
        }
      } catch {
        return null
      }
    })()
    if (!baseEventBus) {
      logger.warn('[search.cli] eventBus unavailable; vector embeddings may not be refreshed. Run bootstrap or ensure event bus configuration.')
    }

    const partitionCount = Math.max(1, partitionsOption ?? DEFAULT_REINDEX_PARTITIONS)
    if (partitionIndexOption !== undefined && partitionIndexOption >= partitionCount) {
      logger.error(`partitionIndex (${partitionIndexOption}) must be < partitionCount (${partitionCount})`)
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

    const runReindex = async (entityType: string, purgeFirst: boolean) => {
      const scopeLabel = tenantId
        ? `tenant=${tenantId}${organizationId ? `, org=${organizationId}` : ''}`
        : 'all tenants'
      logger.info(`Reindexing vectors for ${entityType} (${scopeLabel})${purgeFirst ? ' [purge]' : ''}`)
      await recordIndexerLog(
        { em: baseEm ?? undefined },
        {
          source: 'vector',
          handler: 'cli:search.reindex',
          message: `Reindex started for ${entityType}`,
          entityType,
          tenantId: tenantId ?? null,
          organizationId: organizationId ?? null,
          details: {
            purgeFirst,
            partitions: partitionTargets.length,
            partitionCount,
            partitionIndex: partitionIndexOption ?? null,
            batchSize,
          },
        },
      ).catch(() => undefined)

      if (purgeFirst && tenantId) {
        try {
          logger.info('  -> purging existing vector index rows...')
          await searchIndexer.purgeEntity({ entityId: entityType as EntityId, tenantId })
          await resetVectorCoverageAfterPurge(baseEm, entityType, tenantId ?? null, organizationId ?? null)
          if (baseEventBus) {
            const scopes = new Set<string>()
            scopes.add('__null__')
            if (organizationId) scopes.add(organizationId)
            await Promise.all(
              Array.from(scopes).map((scope) => {
                const orgValue = scope === '__null__' ? null : scope
                return baseEventBus!
                  .emitEvent(
                    'query_index.coverage.refresh',
                    {
                      entityType,
                      tenantId: tenantId ?? null,
                      organizationId: orgValue,
                      delayMs: 0,
                    },
                  )
                  .catch(() => undefined)
              }),
            )
          }
        } catch (err) {
          logger.warn('  -> purge failed, continuing with reindex', err instanceof Error ? err.message : err)
        }
      } else if (purgeFirst && !tenantId) {
        logger.warn('  -> skipping purge: tenant scope not provided')
      }

      const verbose = isIndexerVerbose()
      const progressState = verbose ? new Map<number, { last: number }>() : null
      const groupedProgress =
        !verbose && partitionTargets.length > 1
          ? createGroupedProgress(`Reindexing ${entityType}`, partitionTargets)
          : null
      const renderProgress = (part: number, info: PartitionProgressInfo) => {
        if (!progressState) return
        const state = progressState.get(part) ?? { last: 0 }
        const now = Date.now()
        if (now - state.last < 1000 && info.processed < info.total) return
        state.last = now
        progressState.set(part, state)
        const percent = info.total > 0 ? ((info.processed / info.total) * 100).toFixed(2) : '0.00'
        logger.info(
          `     [${entityType}] partition ${part + 1}/${partitionCount}: ${info.processed.toLocaleString()} / ${info.total.toLocaleString()} (${percent}%)`,
        )
      }

      const processed = await Promise.all(
        partitionTargets.map(async (part, idx) => {
          const label = partitionTargets.length > 1 ? ` [partition ${part + 1}/${partitionCount}]` : ''
          if (partitionTargets.length === 1) {
            logger.info(`  -> processing${label}`)
          } else if (verbose && idx === 0) {
            logger.info(`  -> processing partitions in parallel (count=${partitionTargets.length})`)
          }

          const partitionContainer = await createRequestContainer()
          const partitionEm = partitionContainer.resolve<EntityManager>('em')
          try {
            let progressBar: CliProgressBar | null = null
            const useBar = partitionTargets.length === 1
            const stats = await reindexEntity(partitionEm, {
              entityType,
              tenantId: tenantId ?? undefined,
              organizationId: organizationId ?? undefined,
              force,
              batchSize,
              eventBus: baseEventBus ?? undefined,
              emitVectorizeEvents: true,
              partitionCount,
              partitionIndex: part,
              resetCoverage: shouldResetCoverage(part),
              onProgress(info) {
                if (useBar) {
                  if (info.total > 0 && !progressBar) {
                    progressBar = createProgressBar(`Reindexing ${entityType}${label}`, info.total)
                  }
                  progressBar?.update(info.processed)
                } else if (groupedProgress) {
                  groupedProgress.onProgress(part, info)
                } else {
                  renderProgress(part, info)
                }
              },
            })
            if (progressBar) (progressBar as CliProgressBar).complete()
            if (!useBar && groupedProgress) {
              groupedProgress.onProgress(part, { processed: stats.processed, total: stats.total })
            } else if (!useBar) {
              renderProgress(part, { processed: stats.processed, total: stats.total })
            } else {
              logger.info(
                `     processed ${stats.processed} row(s)${stats.total ? ` (base ${stats.total})` : ''}`,
              )
            }
            return stats.processed
          } finally {
            if (typeof (partitionContainer as any)?.dispose === 'function') {
              await (partitionContainer as any).dispose()
            }
          }
        }),
      )

      groupedProgress?.complete()
      const totalProcessed = processed.reduce((acc, value) => acc + value, 0)
      logger.info(`Finished ${entityType}: processed ${totalProcessed} row(s) across ${partitionTargets.length} partition(s)`)
      await recordIndexerLog(
        { em: baseEm ?? undefined },
        {
          source: 'vector',
          handler: 'cli:search.reindex',
          message: `Reindex completed for ${entityType}`,
          entityType,
          tenantId: tenantId ?? null,
          organizationId: organizationId ?? null,
          details: {
            processed: totalProcessed,
            partitions: partitionTargets.length,
            partitionCount,
            partitionIndex: partitionIndexOption ?? null,
            batchSize,
          },
        },
      ).catch(() => undefined)
      return totalProcessed
    }

    const defaultPurge = purgeFlag === true && !skipPurgeFlag

    if (entityId) {
      if (!enabledEntities.has(entityId)) {
        logger.error(`Entity ${entityId} is not enabled for vector search.`)
        return
      }
      const purgeFirst = defaultPurge
      await runReindex(entityId, purgeFirst)
      logger.info('Vector reindex completed.')
      return
    }

    const entityIds = searchIndexer.listEnabledEntities()
    if (!entityIds.length) {
      logger.info('No entities enabled for vector search.')
      return
    }
    logger.info(`Reindexing ${entityIds.length} vector-enabled entities...`)
    let processedOverall = 0
    for (let idx = 0; idx < entityIds.length; idx += 1) {
      const id = entityIds[idx]!
      logger.info(`[${idx + 1}/${entityIds.length}] Preparing ${id}...`)
      processedOverall += await runReindex(id, defaultPurge)
    }
    logger.info(`Vector reindex completed. Total processed rows: ${processedOverall.toLocaleString()}`)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('[search.cli] Reindex failed:', err.stack ?? err.message)
    await recordError(err)
    throw err
  } finally {
    await disposeContainer()
  }
}

const reindexCli: ModuleCli = {
const logger = cliLogger.forModule('core')
  command: 'reindex',
  async run(rest) {
    await reindexCommand(rest)
  },
}

const reindexHelpCli: ModuleCli = {
const logger = cliLogger.forModule('core')
  command: 'reindex-help',
  async run() {
    logger.info('Usage: yarn mercato search reindex [options]')
    logger.info('  --tenant <id>           Optional tenant scope (required for purge & coverage).')
    logger.info('  --org <id>              Optional organization scope (requires tenant).')
    logger.info('  --entity <module:entity> Reindex a single entity (defaults to all enabled entities).')
    logger.info('  --partitions <n>        Number of partitions to process in parallel (default from query index).')
    logger.info('  --partition <idx>       Restrict to a specific partition index.')
    logger.info('  --batch <n>             Override batch size per chunk.')
    logger.info('  --force                 Force reindex even if another job is running.')
    logger.info('  --purgeFirst            Purge vector rows before reindexing (defaults to skip).')
    logger.info('  --skipPurge             Explicitly skip purging vector rows.')
    logger.info('  --skipResetCoverage     Keep existing coverage snapshots.')
  },
}

/**
 * Start a queue worker for processing search indexing jobs.
 */
async function workerCommand(rest: string[]): Promise<void> {
  const queueName = rest[0]
  const args = parseArgs(rest)
  const concurrency = toPositiveInt(numberOpt(args, 'concurrency')) ?? 1

  const validQueues = [VECTOR_INDEXING_QUEUE_NAME, FULLTEXT_INDEXING_QUEUE_NAME]

  if (!queueName || !validQueues.includes(queueName)) {
    logger.error('\nUsage: yarn mercato search worker <queue-name> [options]\n')
    logger.error('Available queues:')
    logger.error(`  ${VECTOR_INDEXING_QUEUE_NAME}        Process vector embedding indexing jobs`)
    logger.error(`  ${FULLTEXT_INDEXING_QUEUE_NAME}   Process fulltext indexing jobs`)
    logger.error('\nOptions:')
    logger.error('  --concurrency <n>   Number of concurrent jobs to process (default: 1)')
    logger.error('\nExamples:')
    logger.error(`  yarn mercato search worker ${VECTOR_INDEXING_QUEUE_NAME} --concurrency=10`)
    logger.error(`  yarn mercato search worker ${FULLTEXT_INDEXING_QUEUE_NAME} --concurrency=5`)
    return
  }

  // Check if Redis is configured for async queue
  const queueStrategy = process.env.QUEUE_STRATEGY || 'local'
  if (queueStrategy !== 'async') {
    logger.error('\nError: Queue workers require QUEUE_STRATEGY=async')
    logger.error('Set QUEUE_STRATEGY=async and configure REDIS_URL in your environment.\n')
    return
  }

  const redisUrl = getRedisUrl('QUEUE')

  // Dynamically import runWorker to avoid loading BullMQ unless needed
  const { runWorker } = await import('@open-mercato/queue/worker')

  logger.info(`\nStarting ${queueName} worker...`)
  logger.info(`  Concurrency: ${concurrency}`)
  logger.info(`  Redis: ${redisUrl.replace(/\/\/[^:]+:[^@]+@/, '//<credentials>@')}`)
  logger.info('')

  if (queueName === VECTOR_INDEXING_QUEUE_NAME) {
    const { handleVectorIndexJob } = await import('./workers/vector-index.worker')
    const container = await createRequestContainer()

    await runWorker<VectorIndexJobPayload>({
      queueName: VECTOR_INDEXING_QUEUE_NAME,
      handler: async (job: QueuedJob<VectorIndexJobPayload>, ctx: JobContext) => {
        await handleVectorIndexJob(job, ctx, { resolve: container.resolve.bind(container) })
      },
      connection: { url: redisUrl },
      concurrency,
    })
  } else if (queueName === FULLTEXT_INDEXING_QUEUE_NAME) {
    const { handleFulltextIndexJob } = await import('./workers/fulltext-index.worker')
    const container = await createRequestContainer()

    await runWorker<FulltextIndexJobPayload>({
      queueName: FULLTEXT_INDEXING_QUEUE_NAME,
      handler: async (job: QueuedJob<FulltextIndexJobPayload>, ctx: JobContext) => {
        await handleFulltextIndexJob(job, ctx, { resolve: container.resolve.bind(container) })
      },
      connection: { url: redisUrl },
      concurrency,
    })
  }
}

const workerCli: ModuleCli = {
const logger = cliLogger.forModule('core')
  command: 'worker',
  async run(rest) {
    await workerCommand(rest)
  },
}

const helpCli: ModuleCli = {
const logger = cliLogger.forModule('core')
  command: 'help',
  async run() {
    logger.info('\nUsage: yarn mercato search <command> [options]\n')
    logger.info('Commands:')
    logger.info('  status              Show search module status and available strategies')
    logger.info('  query               Execute a search query')
    logger.info('  index               Index a specific record')
    logger.info('  reindex             Reindex vector embeddings for entities')
    logger.info('  reindex-help        Show reindex command options')
    logger.info('  test-meilisearch    Test Meilisearch connection')
    logger.info('  worker              Start a queue worker for search indexing')
    logger.info('  help                Show this help message')
    logger.info('\nExamples:')
    logger.info('  yarn mercato search status')
    logger.info('  yarn mercato search query --query "john doe" --tenant tenant-123')
    logger.info('  yarn mercato search index --entity customers:customer_person_profile --record abc123 --tenant tenant-123')
    logger.info('  yarn mercato search reindex --tenant tenant-123 --entity customers:customer_person_profile')
    logger.info('  yarn mercato search test-meilisearch')
    logger.info(`  yarn mercato search worker ${VECTOR_INDEXING_QUEUE_NAME} --concurrency=10`)
    logger.info(`  yarn mercato search worker ${FULLTEXT_INDEXING_QUEUE_NAME} --concurrency=5`)
  },
}

export default [searchCli, statusCli, indexCli, reindexCli, reindexHelpCli, testMeilisearchCli, workerCli, helpCli]
