import type { ModuleCli } from '@/modules/registry'
import { createRequestContainer } from '@/lib/di/container'
import type { SearchService } from '../../service'
import type { SearchIndexer } from '../../indexer/search-indexer'

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

const helpCli: ModuleCli = {
  command: 'help',
  async run() {
    console.log('\nUsage: yarn mercato search <command> [options]\n')
    console.log('Commands:')
    console.log('  status              Show search module status and available strategies')
    console.log('  query               Execute a search query')
    console.log('  index               Index a specific record')
    console.log('  test-meilisearch    Test Meilisearch connection')
    console.log('  help                Show this help message')
    console.log('\nExamples:')
    console.log('  yarn mercato search status')
    console.log('  yarn mercato search query --query "john doe" --tenant tenant-123')
    console.log('  yarn mercato search index --entity customers:customer_person_profile --record abc123 --tenant tenant-123')
    console.log('  yarn mercato search test-meilisearch')
  },
}

export default [searchCli, statusCli, indexCli, testMeilisearchCli, helpCli]
