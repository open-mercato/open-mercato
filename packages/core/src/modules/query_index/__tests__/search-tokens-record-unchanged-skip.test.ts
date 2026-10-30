import type { Kysely } from 'kysely'
import { resolveSearchConfig } from '@open-mercato/shared/lib/search/config'
import { tokenizeText } from '@open-mercato/shared/lib/search/tokenize'
import { replaceSearchTokensForRecord } from '../lib/search-tokens'

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

/**
 * In-memory stand-in for `search_tokens`, sibling to the one in
 * `search-tokens-unchanged-skip.test.ts` (the batch path) but taught the two shapes the per-record
 * path uses and that one does not: an ungrouped `count(*)` probe, and a delete narrowed by an
 * expression-builder OR over `(entity_id, field)` pairs.
 *
 * Rows carry a synthetic `id` so a test can tell "left alone" from "deleted and re-inserted with
 * identical content" — the only assertion that proves the skip, since a delete-then-reinsert leaves
 * the row count identical and every id different.
 */
function createSearchTokenStore() {
  const rows: StoredRow[] = []
  const reads: Array<{ kind: 'count' | 'rows'; rowCount: number; via: string }> = []
  let nextId = 1
  let transactionCount = 0

  const assertTable = (table: unknown) => {
    if (String(table) !== 'search_tokens') throw new Error(`[internal] unexpected table: ${String(table)}`)
  }

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

  const selectChain = (via: string) => (table: unknown) => {
    assertTable(table)
    const predicates: Matcher[] = []
    let columns: string[] | null = null
    let limit: number | null = null
    const chain: any = {
      // A column list means the content read; anything else is the `count(*)` aggregate builder,
      // which carries no column name to parse.
      select: (selection: unknown) => {
        columns = Array.isArray(selection) ? selection.filter((col) => typeof col === 'string').map(String) : null
        return chain
      },
      where: (...args: unknown[]) => {
        predicates.push(buildPredicate(args))
        return chain
      },
      limit: (count: number) => {
        limit = count
        return chain
      },
      execute: async () => {
        const matched = rows.filter((row) => predicates.every((matches) => matches(row)))
        if (!columns) {
          reads.push({ kind: 'count', rowCount: 1, via })
          return [{ token_count: String(matched.length) }]
        }
        const limited = limit === null ? matched : matched.slice(0, limit)
        reads.push({ kind: 'rows', rowCount: limited.length, via })
        return limited.map((row) => Object.fromEntries(columns!.map((column) => [column, columnOf(row, column)])))
      },
    }
    return chain
  }

  const deleteChain = (table: unknown) => {
    assertTable(table)
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

  const insertChain = (table: unknown) => {
    assertTable(table)
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

  const makeExecutor = (via: string) => ({
    selectFrom: selectChain(via),
    deleteFrom: deleteChain,
    insertInto: insertChain,
  })

  const callerTransaction = makeExecutor('caller-trx')

  const db = {
    ...makeExecutor('db'),
    transaction: () => ({
      execute: async (callback: (trx: unknown) => Promise<void>) => {
        transactionCount += 1
        return callback(makeExecutor('own-trx'))
      },
    }),
  } as unknown as Kysely<any>

  return {
    db,
    callerTransaction,
    rows,
    get transactionCount() {
      return transactionCount
    },
    get reads() {
      return reads
    },
    rowIds: (field?: string) =>
      rows
        .filter((row) => field === undefined || row.field === field)
        .map((row) => row.id)
        .sort((a, b) => a - b),
    fields: () => Array.from(new Set(rows.map((row) => row.field))).sort(),
    insertRaw: (row: Omit<StoredRow, 'id'>) => {
      rows.push({ ...row, id: nextId++ })
    },
    duplicateAll: () => {
      for (const row of [...rows]) rows.push({ ...row, id: nextId++ })
    },
  }
}

const ENTITY_TYPE = 'sales:sales_order'
const SCOPE = { organizationId: 'org-1', tenantId: 'tenant-1' }

const params = (doc: Record<string, unknown> | null) => ({
  entityType: ENTITY_TYPE,
  recordId: 'order-1',
  organizationId: SCOPE.organizationId,
  tenantId: SCOPE.tenantId,
  doc,
})

const storedRow = (field: string, tokenHash: string): Omit<StoredRow, 'id'> => ({
  entity_type: ENTITY_TYPE,
  entity_id: 'order-1',
  organization_id: SCOPE.organizationId,
  tenant_id: SCOPE.tenantId,
  field,
  token_hash: tokenHash,
  token: null,
})

const hashOf = (word: string): string => tokenizeText(word, resolveSearchConfig()).hashes[0]

describe('replaceSearchTokensForRecord — skips records whose tokens have not changed', () => {
  const previousEnv = {
    enabled: process.env.OM_SEARCH_ENABLED,
    partials: process.env.OM_SEARCH_ENABLE_PARTIAL,
    rawTokens: process.env.OM_SEARCH_STORE_RAW_TOKENS,
  }

  beforeAll(() => {
    process.env.OM_SEARCH_ENABLED = 'true'
    // Partials off keeps the token set small and the expected hashes predictable; the skip logic is
    // independent of how many tokens a field yields.
    process.env.OM_SEARCH_ENABLE_PARTIAL = 'false'
  })

  afterEach(() => {
    if (previousEnv.rawTokens === undefined) delete process.env.OM_SEARCH_STORE_RAW_TOKENS
    else process.env.OM_SEARCH_STORE_RAW_TOKENS = previousEnv.rawTokens
  })

  afterAll(() => {
    if (previousEnv.enabled === undefined) delete process.env.OM_SEARCH_ENABLED
    else process.env.OM_SEARCH_ENABLED = previousEnv.enabled
    if (previousEnv.partials === undefined) delete process.env.OM_SEARCH_ENABLE_PARTIAL
    else process.env.OM_SEARCH_ENABLE_PARTIAL = previousEnv.partials
  })

  it('leaves an unchanged record untouched instead of deleting and re-inserting its rows', async () => {
    const store = createSearchTokenStore()
    await replaceSearchTokensForRecord(store.db, params({ title: 'alpha widget' }))
    // Vacuity guard: with search disabled the function returns early and every assertion below
    // would hold for the wrong reason.
    expect(store.rows.length).toBeGreaterThan(0)
    const idsBefore = store.rowIds()

    await replaceSearchTokensForRecord(store.db, params({ title: 'alpha widget' }))

    expect(store.rowIds()).toEqual(idsBefore)
    expect(store.transactionCount).toBe(1)
    // Whatever the table holds, the rows pulled into memory stay bounded by what was just built.
    expect(store.reads.filter((read) => read.kind === 'rows').every((read) => read.rowCount <= idsBefore.length)).toBe(true)
  })

  it('still rewrites a changed record, and the new value is searchable afterwards', async () => {
    const store = createSearchTokenStore()
    await replaceSearchTokensForRecord(store.db, params({ title: 'alpha widget' }))
    const idsBefore = new Set(store.rowIds())
    expect(idsBefore.size).toBeGreaterThan(0)

    await replaceSearchTokensForRecord(store.db, params({ title: 'beta widget' }))

    expect(store.rowIds().some((id) => idsBefore.has(id))).toBe(false)
    expect(store.rows.some((row) => row.token_hash === hashOf('beta'))).toBe(true)
    expect(store.rows.some((row) => row.token_hash === hashOf('alpha'))).toBe(false)
    expect(store.transactionCount).toBe(2)
  })

  it('compares only the fields this document writes, so a row under another field does not defeat the skip', async () => {
    const store = createSearchTokenStore()
    await replaceSearchTokensForRecord(store.db, params({ title: 'alpha widget', 'cf:priority': 'high' }))
    const idsBefore = store.rowIds()
    expect(idsBefore.length).toBeGreaterThan(0)
    // The shape a deployment carries after the aliased-key double write: the same tokens under a
    // field name no writer will ever produce again. It sits outside this document's field set, so
    // a wider comparison would report a difference on every write and the skip would never fire.
    store.insertRaw(storedRow('cf_priority', hashOf('high')))

    await replaceSearchTokensForRecord(store.db, params({ title: 'alpha widget', 'cf:priority': 'high' }))

    expect(store.rowIds('cf_priority').length).toBe(1)
    expect(store.rowIds().filter((id) => idsBefore.includes(id))).toEqual(idsBefore)
    expect(store.transactionCount).toBe(1)
  })

  it('rewrites a record whose stored rows contain a token the document no longer produces', async () => {
    const store = createSearchTokenStore()
    await replaceSearchTokensForRecord(store.db, params({ title: 'alpha widget' }))
    const seededCount = store.rows.length
    expect(seededCount).toBeGreaterThan(0)
    store.insertRaw(storedRow('title', 'stale-hash'))

    await replaceSearchTokensForRecord(store.db, params({ title: 'alpha widget' }))

    expect(store.rows.some((row) => row.token_hash === 'stale-hash')).toBe(false)
    expect(store.rows.length).toBe(seededCount)
  })

  it('collapses duplicated stored rows instead of reading them as already correct', async () => {
    const store = createSearchTokenStore()
    await replaceSearchTokensForRecord(store.db, params({ title: 'alpha widget' }))
    const seededCount = store.rows.length
    expect(seededCount).toBeGreaterThan(0)
    store.duplicateAll()
    expect(store.rows.length).toBe(seededCount * 2)

    await replaceSearchTokensForRecord(store.db, params({ title: 'alpha widget' }))

    expect(store.rows.length).toBe(seededCount)
  })

  it('settles a runaway stored set on the count probe alone, without reading the surplus rows', async () => {
    const store = createSearchTokenStore()
    await replaceSearchTokensForRecord(store.db, params({ title: 'alpha widget' }))
    const builtCount = store.rows.length
    expect(builtCount).toBeGreaterThan(0)
    for (let index = 0; index < 200; index += 1) {
      store.insertRaw(storedRow('title', `stale-${index}`))
    }
    const readsBefore = store.reads.length

    await replaceSearchTokensForRecord(store.db, params({ title: 'alpha widget' }))

    expect(store.rows.length).toBe(builtCount)
    expect(store.rows.some((row) => row.token_hash.startsWith('stale-'))).toBe(false)
    expect(store.reads.slice(readsBefore).map((read) => read.kind)).toEqual(['count'])
  })

  it('skips an unchanged record when raw tokens are stored, so a stored NULL is not the only case covered', async () => {
    process.env.OM_SEARCH_STORE_RAW_TOKENS = 'true'
    const store = createSearchTokenStore()
    await replaceSearchTokensForRecord(store.db, params({ title: 'alpha widget' }))
    expect(store.rows.length).toBeGreaterThan(0)
    expect(store.rows.every((row) => row.token !== null)).toBe(true)
    const idsBefore = store.rowIds()

    await replaceSearchTokensForRecord(store.db, params({ title: 'alpha widget' }))

    expect(store.rowIds()).toEqual(idsBefore)
    expect(store.transactionCount).toBe(1)
  })

  it('deletes the stored rows of a record that no longer produces tokens, and skips once they are gone', async () => {
    const store = createSearchTokenStore()
    await replaceSearchTokensForRecord(store.db, params({ title: 'alpha widget' }))
    expect(store.rows.length).toBeGreaterThan(0)

    await replaceSearchTokensForRecord(store.db, params({ title: '' }))
    expect(store.rows).toEqual([])

    await replaceSearchTokensForRecord(store.db, params({ title: '' }))
    expect(store.transactionCount).toBe(2)
  })

  it('opens no transaction for a record with no document and no stored rows', async () => {
    const store = createSearchTokenStore()

    await replaceSearchTokensForRecord(store.db, params(null))

    expect(store.transactionCount).toBe(0)
  })

  it('reads through the caller transaction, so its own uncommitted writes are visible', async () => {
    const store = createSearchTokenStore()
    await replaceSearchTokensForRecord(store.db, params({ title: 'alpha widget' }))
    expect(store.rows.length).toBeGreaterThan(0)
    const readsBefore = store.reads.length

    // A caller-supplied executor is the write context. Reading on a separate connection could
    // report rows a pending delete in that transaction has already removed, and talk this call out
    // of re-inserting them.
    await replaceSearchTokensForRecord(store.db, params({ title: 'beta widget' }), {
      trx: store.callerTransaction as never,
    })

    const readsDuringCall = store.reads.slice(readsBefore)
    expect(readsDuringCall.length).toBeGreaterThan(0)
    expect(readsDuringCall.every((read) => read.via === 'caller-trx')).toBe(true)
    // The caller owns the transaction, so this path must not open one of its own.
    expect(store.transactionCount).toBe(1)
    expect(store.rows.some((row) => row.token_hash === hashOf('beta'))).toBe(true)
  })
})
