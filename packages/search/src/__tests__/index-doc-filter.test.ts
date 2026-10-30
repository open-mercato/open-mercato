import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  sql,
  type CompiledQuery,
} from 'kysely'
import type { SearchIndexDocFilter, SearchOptions, SearchResult, SearchStrategy } from '@open-mercato/shared/modules/search'
import {
  buildIndexDocFilterExists,
  buildIndexDocFilterPredicate,
  compileIndexDocFilterExists,
} from '../lib/index-doc-filter'
import { TokenSearchStrategy } from '../strategies/token.strategy'
import { VectorSearchStrategy } from '../strategies/vector.strategy'
import { FullTextSearchStrategy } from '../strategies/fulltext.strategy'
import { SearchService } from '../service'
import { createPgVectorDriver, type PgPool } from '../vector/drivers/pgvector'
import type { VectorDriver } from '../vector/types'
import type { FullTextSearchDriver } from '../fulltext/types'

const SCOPE_FILTER: SearchIndexDocFilter = {
  anyOf: [
    [
      { op: 'eq', key: 'is_active', value: true },
      { op: 'exists', key: 'scope_keys' },
      { op: 'overlap', key: 'scope_keys', values: ['cat:a', 'cat:b'] },
      { op: 'noverlap', key: 'scope_keys', values: ['tag:x'] },
      { op: 'recordIdNotIn', values: ['p-9'] },
    ],
    [
      { op: 'eq', key: 'is_active', value: true },
      { op: 'exists', key: 'scope_keys' },
      { op: 'overlap', key: 'scope_keys', values: ['tag:sale'] },
    ],
  ],
}

function createCompileDb(captured: CompiledQuery[] = []): Kysely<Record<string, never>> {
  return new Kysely<Record<string, never>>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
    log: (event) => {
      captured.push(event.query)
    },
  })
}

function compile(filter: SearchIndexDocFilter): CompiledQuery {
  return sql`select ${buildIndexDocFilterPredicate(filter)}`.compile(createCompileDb())
}

describe('index-doc filter compilation', () => {
  it('compiles an empty disjunction to false so a deny-all filter never widens', () => {
    expect(compile({ anyOf: [] }).sql).toBe('select false')
  })

  it('compiles an empty branch to true', () => {
    expect(compile({ anyOf: [[]] }).sql).toBe('select (true)')
  })

  it('compiles each condition with the query engine index-document semantics', () => {
    const compiled = compile(SCOPE_FILTER)
    expect(compiled.sql).toContain(`("om_index_doc"."doc" -> 'is_active') #>> '{}') = $1`)
    expect(compiled.sql).toContain(`jsonb_typeof(("om_index_doc"."doc" -> 'scope_keys')) <> 'null'`)
    expect(compiled.sql).toContain(`("om_index_doc"."doc" -> 'scope_keys') ?| $2::text[]`)
    expect(compiled.sql).toContain(
      `(jsonb_typeof(("om_index_doc"."doc" -> 'scope_keys')) = 'array' and not (("om_index_doc"."doc" -> 'scope_keys') ?| $3::text[]))`,
    )
    expect(compiled.sql).toContain(`not ("om_index_doc"."entity_id" = any($4::text[]))`)
    expect(compiled.sql).toContain(') or (')
    expect(compiled.parameters).toEqual(['true', ['cat:a', 'cat:b'], ['tag:x'], ['p-9'], 'true', ['tag:sale']])
  })

  it('compiles an empty overlap to false and an empty exclusion list to true', () => {
    const compiled = compile({
      anyOf: [[{ op: 'overlap', key: 'scope_keys', values: [] }, { op: 'recordIdNotIn', values: [] }]],
    })
    expect(compiled.sql).toBe('select ((false and true))')
  })

  it('correlates the exists clause to the ranked row and to live index rows only', () => {
    const compiled = sql`select ${buildIndexDocFilterExists(SCOPE_FILTER, {
      entityTypeRef: 'search_tokens.entity_type',
      recordIdRef: 'search_tokens.entity_id',
      tenantIdRef: 'search_tokens.tenant_id',
    })}`.compile(createCompileDb())
    expect(compiled.sql).toContain('exists (select 1 from entity_indexes as "om_index_doc" where')
    expect(compiled.sql).toContain('"om_index_doc"."entity_type" = "search_tokens"."entity_type"')
    expect(compiled.sql).toContain('"om_index_doc"."entity_id" = ("search_tokens"."entity_id")::text')
    expect(compiled.sql).toContain('"om_index_doc"."tenant_id" = "search_tokens"."tenant_id"')
    expect(compiled.sql).toContain('"om_index_doc"."deleted_at" is null')
  })

  it('renumbers placeholders after the caller\'s own parameters for raw-SQL drivers', () => {
    const compiled = compileIndexDocFilterExists(
      SCOPE_FILTER,
      { entityTypeRef: 'vector_search.entity_id', recordIdRef: 'vector_search.record_id', tenantIdRef: 'vector_search.tenant_id' },
      7,
    )
    expect(compiled.sql).toContain('= $7')
    expect(compiled.sql).toContain('$12::text[]')
    expect(compiled.sql).not.toMatch(/\$[1-6](?!\d)/)
    expect(compiled.parameters).toHaveLength(6)
  })
})

describe('TokenSearchStrategy with an index-doc filter', () => {
  it('ranks and filters in one query: the exists clause precedes grouping, ordering and the limit', async () => {
    const captured: CompiledQuery[] = []
    const strategy = new TokenSearchStrategy(createCompileDb(captured) as never)

    await strategy.search('sukienka', {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      entityTypes: ['catalog:catalog_product'],
      limit: 8,
      indexDocFilter: SCOPE_FILTER,
    })

    expect(captured).toHaveLength(1)
    const [query] = captured
    const existsAt = query.sql.indexOf('exists (select 1 from entity_indexes')
    expect(existsAt).toBeGreaterThan(query.sql.indexOf('where'))
    expect(existsAt).toBeLessThan(query.sql.indexOf('group by'))
    expect(query.sql.indexOf('group by')).toBeLessThan(query.sql.indexOf('order by'))
    expect(query.sql).toMatch(/limit \$\d+$/)
    expect(query.parameters[query.parameters.length - 1]).toBe(8)
    expect(query.parameters).toContainEqual(['cat:a', 'cat:b'])
  })

  it('issues the unchanged query when no filter is passed', async () => {
    const captured: CompiledQuery[] = []
    const strategy = new TokenSearchStrategy(createCompileDb(captured) as never)

    await strategy.search('sukienka', { tenantId: 'tenant-1', entityTypes: ['catalog:catalog_product'] })

    expect(captured[0].sql).not.toContain('entity_indexes')
  })
})

type QueryCall = { text: string; params?: unknown[] }

function createPool(calls: QueryCall[]): PgPool {
  const run = async (text: string, params?: unknown[]) => {
    calls.push({ text, params })
    if (/pg_available_extensions/.test(text)) return { rows: [{ installed: true, installable: true }] }
    return { rows: [] }
  }
  return {
    connect: async () => ({ query: run as PgPool['query'], release: () => {} }),
    query: run as PgPool['query'],
    end: async () => {},
  }
}

describe('pgvector driver with an index-doc filter', () => {
  it('declares support and appends the exists clause to the similarity query before ORDER BY', async () => {
    const calls: QueryCall[] = []
    const driver = createPgVectorDriver({ pool: createPool(calls), dimension: 3 })
    expect(driver.supportsIndexDocFilter).toBe(true)

    await driver.query({ vector: [0.1, 0.2, 0.3], limit: 8, filter: { tenantId: 'tenant-1', indexDocFilter: SCOPE_FILTER } })

    const similarity = calls.find((call) => call.text.includes('embedding <=> $1::vector AS distance'))
    expect(similarity).toBeDefined()
    const text = similarity?.text ?? ''
    const existsAt = text.indexOf('AND exists (select 1 from entity_indexes as "om_index_doc"')
    expect(existsAt).toBeGreaterThan(0)
    expect(existsAt).toBeLessThan(text.indexOf('ORDER BY'))
    expect(text).toContain('"om_index_doc"."entity_type" = "vector_search"."entity_id"')
    expect(text).toContain('"om_index_doc"."entity_id" = ("vector_search"."record_id")::text')
    expect(text).toContain('LIMIT $6')
    expect(similarity?.params?.[5]).toBe(8)
    expect(similarity?.params?.slice(6)).toEqual(['true', ['cat:a', 'cat:b'], ['tag:x'], ['p-9'], 'true', ['tag:sale']])
  })

  it('keeps the six-parameter query when no filter is passed', async () => {
    const calls: QueryCall[] = []
    const driver = createPgVectorDriver({ pool: createPool(calls), dimension: 3 })

    await driver.query({ vector: [0.1, 0.2, 0.3], limit: 8, filter: { tenantId: 'tenant-1' } })

    const similarity = calls.find((call) => call.text.includes('embedding <=> $1::vector AS distance'))
    expect(similarity?.text).not.toContain('entity_indexes')
    expect(similarity?.params).toHaveLength(6)
  })
})

function vectorDriverWithoutSupport(query: jest.Mock): VectorDriver {
  return {
    id: 'qdrant',
    ensureReady: async () => {},
    upsert: async () => {},
    delete: async () => {},
    query,
    getChecksum: async () => null,
  }
}

describe('fail-closed strategies', () => {
  it('a vector strategy over a driver without filter support returns nothing for a filtered search', async () => {
    const query = jest.fn().mockResolvedValue([])
    const strategy = new VectorSearchStrategy(
      { available: true, createEmbedding: async () => [0.1] },
      vectorDriverWithoutSupport(query),
    )

    expect(strategy.supportsIndexDocFilter).toBe(false)
    expect(await strategy.search('dress', { tenantId: 'tenant-1', indexDocFilter: SCOPE_FILTER })).toEqual([])
    expect(query).not.toHaveBeenCalled()
  })

  it('the fulltext strategy returns nothing for a filtered search', async () => {
    const driverQuery = jest.fn()
    const strategy = new FullTextSearchStrategy({ query: driverQuery } as unknown as FullTextSearchDriver)

    expect(strategy.supportsIndexDocFilter).toBeUndefined()
    expect(await strategy.search('dress', { tenantId: 'tenant-1', indexDocFilter: SCOPE_FILTER })).toEqual([])
    expect(driverQuery).not.toHaveBeenCalled()
  })

  it('SearchService skips strategies that cannot apply the filter', async () => {
    const hit = (source: string): SearchResult => ({ entityId: 'catalog:catalog_product', recordId: `r-${source}`, score: 1, source })
    const supported = jest.fn(async (_query: string, _options: SearchOptions) => [hit('tokens')])
    const unsupported = jest.fn(async (_query: string, _options: SearchOptions) => [hit('fulltext')])
    const strategy = (id: string, search: SearchStrategy['search'], supportsIndexDocFilter?: boolean): SearchStrategy => ({
      id,
      name: id,
      priority: 1,
      supportsIndexDocFilter,
      isAvailable: async () => true,
      ensureReady: async () => {},
      search,
      index: async () => {},
      delete: async () => {},
    })
    const service = new SearchService({
      strategies: [strategy('tokens', supported, true), strategy('fulltext', unsupported)],
      defaultStrategies: ['fulltext', 'tokens'],
    })

    const filtered = await service.search('dress', { tenantId: 'tenant-1', indexDocFilter: SCOPE_FILTER })
    expect(filtered.map((result) => result.source)).toEqual(['tokens'])
    expect(unsupported).not.toHaveBeenCalled()

    const unfiltered = await service.search('dress', { tenantId: 'tenant-1' })
    expect(unfiltered.map((result) => result.source).sort((left, right) => left.localeCompare(right))).toEqual([
      'fulltext',
      'tokens',
    ])
  })
})
