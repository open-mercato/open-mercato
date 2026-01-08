import type { ModuleCli } from '@/modules/registry'
import { createRequestContainer } from '@/lib/di/container'
import { recordIndexerError } from '@/lib/indexers/error-log'
import { recordIndexerLog } from '@/lib/indexers/status-log'
import { createProgressBar } from '@open-mercato/shared/lib/cli/progress'
import type { VectorIndexService } from '../../vector'
import type { EntityManager } from '@mikro-orm/postgresql'
import { reindexEntity, DEFAULT_REINDEX_PARTITIONS } from '@open-mercato/core/modules/query_index/lib/reindexer'
import { writeCoverageCounts } from '@open-mercato/core/modules/query_index/lib/coverage'
import type { SearchService } from '../../service'
import type { SearchIndexer } from '../../indexer/search-indexer'

type CliProgressBar = {
  update(completed: number): void
  complete(): void
}

type ParsedArgs = Record<string, string | boolean>

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
      const normalized = raw.trim().toLowerCase()
      if (['1', 'true', 'yes', 'y', ''].includes(normalized)) return true
      if (['0', 'false', 'no', 'n'].includes(normalized)) return false
      return true
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
    console.error('Usage: yarn mercato search query --query "search terms" --tenant <id> [options]')
    console.error('  --query, -q       Search query (required)')
    console.error('  --tenant          Tenant ID (required)')
    console.error('  --org             Organization ID (optional)')
    console.error('  --entity          Entity types to search (comma-separated)')
    console.error('  --strategy        Strategies to use (comma-separated: meilisearch,vector,tokens)')
    console.error('  --limit           Max results (default: 20)')
    return
  }

  if (!tenantId) {
    console.error('Error: --tenant is required')
    return
  }

  const container = await createRequestContainer()

  try {
    const searchService = container.resolve('searchService') as SearchService | undefined

    if (!searchService) {
      console.error('Error: SearchService not available. Make sure the search module is registered.')
      return
    }

    console.log(`\nSearching for: "${query}"`)
    console.log(`Tenant: ${tenantId}`)
    if (organizationId) console.log(`Organization: ${organizationId}`)
    console.log('---')

    const results = await searchService.search(query, {
      tenantId,
      organizationId,
      entityTypes: entityTypes?.split(',').map(s => s.trim()),
      strategies: strategies?.split(',').map(s => s.trim()) as any,
      limit,
    })

    if (results.length === 0) {
      console.log('No results found.')
      return
    }

    console.log(`\nFound ${results.length} result(s):\n`)

    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      console.log(`${i + 1}. [${result.source}] ${result.entityId}`)
      console.log(`   Record ID: ${result.recordId}`)
      console.log(`   Score: ${result.score.toFixed(4)}`)
      if (result.presenter) {
        console.log(`   Title: ${result.presenter.title}`)
        if (result.presenter.subtitle) console.log(`   Subtitle: ${result.presenter.subtitle}`)
      }
      if (result.url) console.log(`   URL: ${result.url}`)
      console.log('')
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

    console.log('\n=== Search Module Status ===\n')

    if (!searchService) {
      console.log('SearchService: NOT REGISTERED')
      return
    }

    console.log('SearchService: ACTIVE')
    console.log('')

    if (!strategies || strategies.length === 0) {
      console.log('Strategies: NONE CONFIGURED')
      return
    }

    console.log('Strategies:')
    console.log('-----------')

    for (const strategy of strategies) {
      const available = await strategy.isAvailable?.() ?? true
      const status = available ? 'AVAILABLE' : 'UNAVAILABLE'
      const icon = available ? '✓' : '✗'
      console.log(`  ${icon} ${strategy.name ?? strategy.id} (${strategy.id})`)
      console.log(`    Status: ${status}`)
      console.log(`    Priority: ${strategy.priority ?? 'N/A'}`)
      console.log('')
    }

    // Check environment variables
    console.log('Environment:')
    console.log('------------')
    console.log(`  MEILISEARCH_HOST: ${process.env.MEILISEARCH_HOST ?? '(not set)'}`)
    console.log(`  MEILISEARCH_API_KEY: ${process.env.MEILISEARCH_API_KEY ? '(set)' : '(not set)'}`)
    console.log(`  OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? '(set)' : '(not set)'}`)
    console.log(`  OM_SEARCH_ENABLED: ${process.env.OM_SEARCH_ENABLED ?? 'true (default)'}`)
    console.log('')
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
    console.error('Usage: yarn mercato search index --entity <entityId> --record <recordId> --tenant <tenantId>')
    console.error('  --entity          Entity ID (e.g., customers:customer_person_profile)')
    console.error('  --record          Record ID')
    console.error('  --tenant          Tenant ID')
    console.error('  --org             Organization ID (optional)')
    return
  }

  const container = await createRequestContainer()

  try {
    const searchIndexer = container.resolve('searchIndexer') as SearchIndexer | undefined

    if (!searchIndexer) {
      console.error('Error: SearchIndexer not available.')
      return
    }

    // Load record from query engine
    const queryEngine = container.resolve('queryEngine') as any

    console.log(`\nLoading record: ${entityId} / ${recordId}`)

    const result = await queryEngine.query(entityId, {
      tenantId,
      organizationId,
      filters: { id: recordId },
      includeCustomFields: true,
      page: { page: 1, pageSize: 1 },
    })

    const record = result.items[0]

    if (!record) {
      console.error('Error: Record not found')
      return
    }

    console.log('Record loaded, indexing...')

    // Extract custom fields
    const customFields: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(record)) {
      if (key.startsWith('cf:') || key.startsWith('cf_')) {
        const cfKey = key.startsWith('cf:') ? key.slice(3) : key.slice(3)
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

    console.log('Record indexed successfully!')
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

  console.log('\n=== Meilisearch Connection Test ===\n')

  if (!host) {
    console.log('MEILISEARCH_HOST: NOT SET')
    console.log('\nMeilisearch is not configured. Set MEILISEARCH_HOST in your .env file.')
    return
  }

  console.log(`Host: ${host}`)
  console.log(`API Key: ${apiKey ? '(configured)' : '(not set)'}`)
  console.log('')

  try {
    const { MeiliSearch } = await import('meilisearch')
    const client = new MeiliSearch({ host, apiKey })

    console.log('Testing connection...')
    const health = await client.health()
    console.log(`Health: ${health.status}`)

    console.log('\nListing indexes...')
    const indexes = await client.getIndexes()

    if (indexes.results.length === 0) {
      console.log('No indexes found.')
    } else {
      console.log(`Found ${indexes.results.length} index(es):`)
      for (const index of indexes.results) {
        const stats = await client.index(index.uid).getStats()
        console.log(`  - ${index.uid}: ${stats.numberOfDocuments} documents`)
      }
    }

    console.log('\nMeilisearch connection successful!')
  } catch (error) {
    console.error('Connection failed:', error instanceof Error ? error.message : error)
  }
}

const searchCli: ModuleCli = {
  command: 'query',
  async run(rest) {
    await searchCommand(rest)
  },
}

const statusCli: ModuleCli = {
  command: 'status',
  async run() {
    await statusCommand()
  },
}

const indexCli: ModuleCli = {
  command: 'index',
  async run(rest) {
    await indexCommand(rest)
  },
}

const testMeilisearchCli: ModuleCli = {
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
    console.warn('[search.cli] Failed to reset vector coverage after purge', error instanceof Error ? error.message : error)
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
    const service = (container.resolve('vectorIndexService') as VectorIndexService)
    await service.ensureDriverReady()
    const enabledEntities = new Set(service.listEnabledEntities())
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
      console.warn('[search.cli] eventBus unavailable; vector embeddings may not be refreshed. Run bootstrap or ensure event bus configuration.')
    }

    const partitionCount = Math.max(1, partitionsOption ?? DEFAULT_REINDEX_PARTITIONS)
    if (partitionIndexOption !== undefined && partitionIndexOption >= partitionCount) {
      console.error(`partitionIndex (${partitionIndexOption}) must be < partitionCount (${partitionCount})`)
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
      console.log(`Reindexing vectors for ${entityType} (${scopeLabel})${purgeFirst ? ' [purge]' : ''}`)
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
          console.log('  -> purging existing vector index rows...')
          await service.purgeIndex({ tenantId, organizationId: organizationId ?? null, entityId: entityType })
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
          console.warn('  -> purge failed, continuing with reindex', err instanceof Error ? err.message : err)
        }
      } else if (purgeFirst && !tenantId) {
        console.warn('  -> skipping purge: tenant scope not provided')
      }

      const progressState = new Map<number, { last: number }>()
      const renderProgress = (part: number, info: { processed: number; total: number }) => {
        const state = progressState.get(part) ?? { last: 0 }
        const now = Date.now()
        if (now - state.last < 1000 && info.processed < info.total) return
        state.last = now
        progressState.set(part, state)
        const percent = info.total > 0 ? ((info.processed / info.total) * 100).toFixed(2) : '0.00'
        console.log(
          `     [${entityType}] partition ${part + 1}/${partitionCount}: ${info.processed.toLocaleString()} / ${info.total.toLocaleString()} (${percent}%)`,
        )
      }

      const processed = await Promise.all(
        partitionTargets.map(async (part, idx) => {
          const label = partitionTargets.length > 1 ? ` [partition ${part + 1}/${partitionCount}]` : ''
          if (partitionTargets.length === 1) {
            console.log(`  -> processing${label}`)
          } else if (idx === 0) {
            console.log(`  -> processing partitions in parallel (count=${partitionTargets.length})`)
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
              vectorService: partitionVectorService,
              onProgress(info) {
                if (useBar) {
                  if (info.total > 0 && !progressBar) {
                    progressBar = createProgressBar(`Reindexing ${entityType}${label}`, info.total)
                  }
                  progressBar?.update(info.processed)
                } else {
                  renderProgress(part, info)
                }
              },
            })
            if (progressBar) (progressBar as CliProgressBar).complete()
            if (!useBar) {
              renderProgress(part, { processed: stats.processed, total: stats.total })
            } else {
              console.log(
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

      const totalProcessed = processed.reduce((acc, value) => acc + value, 0)
      console.log(`Finished ${entityType}: processed ${totalProcessed} row(s) across ${partitionTargets.length} partition(s)`)
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
        console.error(`Entity ${entityId} is not enabled for vector search.`)
        return
      }
      const purgeFirst = defaultPurge
      await service.ensureDriverReady(entityId)
      await runReindex(entityId, purgeFirst)
      console.log('Vector reindex completed.')
      return
    }

    const entityIds = service.listEnabledEntities()
    if (!entityIds.length) {
      console.log('No entities enabled for vector search.')
      return
    }
    console.log(`Reindexing ${entityIds.length} vector-enabled entities...`)
    let processedOverall = 0
    for (let idx = 0; idx < entityIds.length; idx += 1) {
      const id = entityIds[idx]!
      console.log(`[${idx + 1}/${entityIds.length}] Preparing ${id}...`)
      await service.ensureDriverReady(id)
      processedOverall += await runReindex(id, defaultPurge)
    }
    console.log(`Vector reindex completed. Total processed rows: ${processedOverall.toLocaleString()}`)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    console.error('[search.cli] Reindex failed:', err.stack ?? err.message)
    await recordError(err)
    throw err
  } finally {
    await disposeContainer()
  }
}

const reindexCli: ModuleCli = {
  command: 'reindex',
  async run(rest) {
    await reindexCommand(rest)
  },
}

const reindexHelpCli: ModuleCli = {
  command: 'reindex-help',
  async run() {
    console.log('Usage: yarn mercato search reindex [options]')
    console.log('  --tenant <id>           Optional tenant scope (required for purge & coverage).')
    console.log('  --org <id>              Optional organization scope (requires tenant).')
    console.log('  --entity <module:entity> Reindex a single entity (defaults to all enabled entities).')
    console.log('  --partitions <n>        Number of partitions to process in parallel (default from query index).')
    console.log('  --partition <idx>       Restrict to a specific partition index.')
    console.log('  --batch <n>             Override batch size per chunk.')
    console.log('  --force                 Force reindex even if another job is running.')
    console.log('  --purgeFirst            Purge vector rows before reindexing (defaults to skip).')
    console.log('  --skipPurge             Explicitly skip purging vector rows.')
    console.log('  --skipResetCoverage     Keep existing coverage snapshots.')
  },
}

const helpCli: ModuleCli = {
  command: 'help',
  async run() {
    console.log('\nUsage: yarn mercato search <command> [options]\n')
    console.log('Commands:')
    console.log('  status              Show search module status and available strategies')
    console.log('  query               Execute a search query')
    console.log('  index               Index a specific record')
    console.log('  reindex             Reindex vector embeddings for entities')
    console.log('  reindex-help        Show reindex command options')
    console.log('  test-meilisearch    Test Meilisearch connection')
    console.log('  help                Show this help message')
    console.log('\nExamples:')
    console.log('  yarn mercato search status')
    console.log('  yarn mercato search query --query "john doe" --tenant tenant-123')
    console.log('  yarn mercato search index --entity customers:customer_person_profile --record abc123 --tenant tenant-123')
    console.log('  yarn mercato search reindex --tenant tenant-123 --entity customers:customer_person_profile')
    console.log('  yarn mercato search test-meilisearch')
  },
}

export default [searchCli, statusCli, indexCli, reindexCli, reindexHelpCli, testMeilisearchCli, helpCli]
