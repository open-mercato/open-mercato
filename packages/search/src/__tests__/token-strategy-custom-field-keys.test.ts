import type { Kysely } from 'kysely'
import { replaceSearchTokensForRecord } from '@open-mercato/core/modules/query_index/lib/search-tokens'
import { TokenSearchStrategy } from '../strategies/token.strategy'
import type { IndexableRecord } from '../types'

/**
 * The search module reaches `search_tokens` through the query engine, which cannot label a column
 * `cf:<key>` and returns the sanitized alias `cf_<key>` instead. Core's own writer builds from
 * `entity_indexes.doc` and keeps `cf:<key>`. Both replace a record's tokens by deleting only the
 * `(entity_id, field)` pairs their own document carries, so under two spellings neither deletes the
 * other's custom-field rows.
 *
 * These tests drive the real core writer against an in-memory `search_tokens` so the two writers
 * meet in one table, which is the only place the divergence is observable.
 */

type StoredRow = {
  id: number
  entity_type: string
  entity_id: string
  organization_id: string | null
  tenant_id: string | null
  field: string
  token_hash: string
  token: string | null
}

type RawBuilderLike = { toOperationNode: () => { sqlFragments: string[]; parameters: Array<{ value?: unknown }> } }
type Matcher = (row: StoredRow) => boolean

const columnOf = (row: StoredRow, column: string): unknown => (row as unknown as Record<string, unknown>)[column]

function createSearchTokenStore() {
  const rows: StoredRow[] = []
  let nextId = 1

  const expressionBuilder = () => {
    const eb: any = (column: string, operator: string, value: unknown): Matcher => {
      if (operator !== '=') throw new Error(`[internal] unsupported eb operator: ${operator}`)
      return (row) => String(columnOf(row, column)) === String(value)
    }
    eb.and = (matchers: Matcher[]): Matcher => (row) => matchers.every((matches) => matches(row))
    eb.or = (matchers: Matcher[]): Matcher => (row) => matchers.some((matches) => matches(row))
    return eb
  }

  const buildPredicate = (args: unknown[]): Matcher => {
    if (args.length === 1) {
      const arg = args[0]
      if (typeof arg === 'function') return (arg as (eb: unknown) => Matcher)(expressionBuilder())
      const node = (arg as RawBuilderLike).toOperationNode()
      const column = String(node.sqlFragments[0]).trim().split(/\s+/)[0]
      const expected = node.parameters[0]?.value ?? null
      return (row) => (columnOf(row, column) ?? null) === expected
    }
    const [column, operator, value] = args as [string, string, unknown]
    if (operator === '=') return (row) => String(columnOf(row, column)) === String(value)
    if (operator === 'in') {
      const allowed = new Set((value as unknown[]).map(String))
      return (row) => allowed.has(String(columnOf(row, column)))
    }
    throw new Error(`[internal] unsupported where operator: ${operator}`)
  }

  const selectChain = () => {
    const predicates: Matcher[] = []
    let columns: string[] | null = null
    let groupedBy: string | null = null
    let limit: number | null = null
    const chain: any = {
      // The batch path's count probe selects an aggregate builder inside a column array and pairs
      // it with groupBy(); the per-record probe passes the aggregate on its own. Neither carries a
      // parseable column name, so both branches key off what else was supplied.
      select: (selection: unknown) => {
        columns = Array.isArray(selection) ? selection.filter((col) => typeof col === 'string').map(String) : null
        return chain
      },
      where: (...args: unknown[]) => {
        predicates.push(buildPredicate(args))
        return chain
      },
      groupBy: (column: unknown) => {
        groupedBy = String(column)
        return chain
      },
      limit: (count: number) => {
        limit = count
        return chain
      },
      execute: async () => {
        const matched = rows.filter((row) => predicates.every((matches) => matches(row)))
        if (groupedBy) {
          const counts = new Map<string, number>()
          for (const row of matched) {
            const groupKey = String(columnOf(row, groupedBy))
            counts.set(groupKey, (counts.get(groupKey) ?? 0) + 1)
          }
          return Array.from(counts.entries()).map(([groupKey, count]) => ({
            [groupedBy as string]: groupKey,
            token_count: String(count),
          }))
        }
        if (!columns) return [{ token_count: String(matched.length) }]
        const limited = limit === null ? matched : matched.slice(0, limit)
        return limited.map((row) => Object.fromEntries(columns!.map((column) => [column, columnOf(row, column)])))
      },
    }
    return chain
  }

  const deleteChain = () => {
    const predicates: Matcher[] = []
    const chain: any = {
      where: (...args: unknown[]) => {
        predicates.push(buildPredicate(args))
        return chain
      },
      execute: async () => {
        const kept = rows.filter((row) => !predicates.every((matches) => matches(row)))
        rows.length = 0
        rows.push(...kept)
        return []
      },
    }
    return chain
  }

  const insertChain = () => {
    const chain: any = {
      values: (values: any[]) => {
        for (const value of values) {
          rows.push({
            id: nextId++,
            entity_type: String(value.entity_type),
            entity_id: String(value.entity_id),
            organization_id: value.organization_id ?? null,
            tenant_id: value.tenant_id ?? null,
            field: String(value.field),
            token_hash: String(value.token_hash),
            token: value.token ?? null,
          })
        }
        return chain
      },
      execute: async () => [],
    }
    return chain
  }

  const executor = {
    selectFrom: selectChain,
    deleteFrom: deleteChain,
    insertInto: insertChain,
  }

  const db = {
    ...executor,
    transaction: () => ({
      execute: async (callback: (trx: unknown) => Promise<void>) => callback(executor),
    }),
  } as unknown as Kysely<any>

  return {
    db,
    rows,
    fields: () => Array.from(new Set(rows.map((row) => row.field))).sort(),
    rowIds: () => rows.map((row) => row.id).sort((a, b) => a - b),
  }
}

const ENTITY_ID = 'sales:sales_order'
const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }

const indexableRecord = (fields: Record<string, unknown>): IndexableRecord => ({
  entityId: ENTITY_ID,
  recordId: 'order-1',
  tenantId: SCOPE.tenantId,
  organizationId: SCOPE.organizationId,
  fields,
})

// What the query engine hands back: base columns plus custom fields under the sanitized alias.
const QUERY_ENGINE_RECORD = { id: 'order-1', title: 'alpha widget', cf_priority: 'urgent' }
// What core stores in `entity_indexes.doc` for the same record.
const INDEX_DOCUMENT = { id: 'order-1', title: 'alpha widget', 'cf:priority': 'urgent' }

const writeCoreTokens = (db: Kysely<any>) =>
  replaceSearchTokensForRecord(db, {
    entityType: ENTITY_ID,
    recordId: 'order-1',
    tenantId: SCOPE.tenantId,
    organizationId: SCOPE.organizationId,
    doc: INDEX_DOCUMENT,
  })

describe('TokenSearchStrategy writes custom fields under the spelling core uses', () => {
  const previousEnv = {
    enabled: process.env.OM_SEARCH_ENABLED,
    partials: process.env.OM_SEARCH_ENABLE_PARTIAL,
  }

  beforeAll(() => {
    process.env.OM_SEARCH_ENABLED = 'true'
    // Partials off keeps the token set small; the field naming is independent of token fan-out.
    process.env.OM_SEARCH_ENABLE_PARTIAL = 'false'
  })

  afterAll(() => {
    if (previousEnv.enabled === undefined) delete process.env.OM_SEARCH_ENABLED
    else process.env.OM_SEARCH_ENABLED = previousEnv.enabled
    if (previousEnv.partials === undefined) delete process.env.OM_SEARCH_ENABLE_PARTIAL
    else process.env.OM_SEARCH_ENABLE_PARTIAL = previousEnv.partials
  })

  it('stores the aliased custom-field key as cf:<key>, leaving base columns alone', async () => {
    const store = createSearchTokenStore()
    const strategy = new TokenSearchStrategy(store.db)

    await strategy.index(indexableRecord(QUERY_ENGINE_RECORD))

    expect(store.rows.length).toBeGreaterThan(0)
    expect(store.fields()).toEqual(['cf:priority', 'title'])
  })

  it('normalizes the same way on the batch path', async () => {
    const store = createSearchTokenStore()
    const strategy = new TokenSearchStrategy(store.db)

    await strategy.bulkIndex([indexableRecord(QUERY_ENGINE_RECORD)])

    expect(store.rows.length).toBeGreaterThan(0)
    expect(store.fields()).toEqual(['cf:priority', 'title'])
  })

  it('keeps an explicit cf: value when a document carries both spellings of one field', async () => {
    const store = createSearchTokenStore()
    const strategy = new TokenSearchStrategy(store.db)

    await strategy.index(indexableRecord({ 'cf:priority': 'urgent', cf_priority: 'stale' }))

    expect(store.fields()).toEqual(['cf:priority'])
    const stored = new Set(store.rows.map((row) => row.token_hash))
    const urgentOnly = createSearchTokenStore()
    await new TokenSearchStrategy(urgentOnly.db).index(indexableRecord({ 'cf:priority': 'urgent' }))
    expect(stored).toEqual(new Set(urgentOnly.rows.map((row) => row.token_hash)))
  })

  it('indexes a record once when both writers run over it, rather than under two field names', async () => {
    const store = createSearchTokenStore()
    const strategy = new TokenSearchStrategy(store.db)

    await writeCoreTokens(store.db)
    const afterCore = store.rowIds()
    expect(afterCore.length).toBeGreaterThan(0)

    await strategy.index(indexableRecord(QUERY_ENGINE_RECORD))

    expect(store.fields()).toEqual(['cf:priority', 'title'])
    // The second writer found exactly the rows it wanted to write and left them in place: two
    // consecutive indexes of an unchanged record write nothing on either path.
    expect(store.rowIds()).toEqual(afterCore)
  })

  it('leaves the record alone when the two writers alternate over it', async () => {
    const store = createSearchTokenStore()
    const strategy = new TokenSearchStrategy(store.db)

    await strategy.index(indexableRecord(QUERY_ENGINE_RECORD))
    const afterFirstWrite = store.rowIds()
    expect(afterFirstWrite.length).toBeGreaterThan(0)

    await writeCoreTokens(store.db)
    await strategy.index(indexableRecord(QUERY_ENGINE_RECORD))
    await writeCoreTokens(store.db)

    expect(store.rowIds()).toEqual(afterFirstWrite)
  })
})
