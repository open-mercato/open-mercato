import type { Kysely } from 'kysely'
import { resolveSearchConfig } from '@open-mercato/shared/lib/search/config'
import { tokenizeText } from '@open-mercato/shared/lib/search/tokenize'
import { replaceSearchTokensForBatch } from '../lib/search-tokens'

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

const columnOf = (row: StoredRow, column: string): unknown => (row as unknown as Record<string, unknown>)[column]

/**
 * In-memory stand-in for the `search_tokens` table. Rows carry a synthetic `id` so a test can
 * distinguish "left alone" from "deleted and re-inserted with identical content" — the only
 * assertion that actually proves the skip, since a delete-then-reinsert leaves the row count
 * identical and every id different.
 */
function createSearchTokenStore() {
  const rows: StoredRow[] = []
  let nextId = 1
  let transactionCount = 0
  let selectCount = 0

  const assertTable = (table: unknown) => {
    if (String(table) !== 'search_tokens') throw new Error(`[internal] unexpected table: ${String(table)}`)
  }

  const buildPredicate = (args: unknown[]): ((row: StoredRow) => boolean) => {
    if (args.length === 1) {
      const node = (args[0] as RawBuilderLike).toOperationNode()
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

  const selectChain = (table: unknown) => {
    assertTable(table)
    const predicates: Array<(row: StoredRow) => boolean> = []
    let columns: string[] = []
    const chain: any = {
      select: (cols: unknown[]) => {
        columns = cols.map(String)
        return chain
      },
      where: (...args: unknown[]) => {
        predicates.push(buildPredicate(args))
        return chain
      },
      execute: async () => {
        selectCount += 1
        return rows
          .filter((row) => predicates.every((matches) => matches(row)))
          .map((row) => Object.fromEntries(columns.map((column) => [column, columnOf(row, column)])))
      },
    }
    return chain
  }

  const deleteChain = (table: unknown) => {
    assertTable(table)
    const predicates: Array<(row: StoredRow) => boolean> = []
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

  const db = {
    selectFrom: selectChain,
    transaction: () => ({
      execute: async (callback: (trx: unknown) => Promise<void>) => {
        transactionCount += 1
        return callback({ deleteFrom: deleteChain, insertInto: insertChain })
      },
    }),
    deleteFrom: deleteChain,
  } as unknown as Kysely<any>

  return {
    db,
    rows,
    get transactionCount() {
      return transactionCount
    },
    get selectCount() {
      return selectCount
    },
    rowIds: (entityId?: string) =>
      rows
        .filter((row) => entityId === undefined || row.entity_id === entityId)
        .map((row) => row.id)
        .sort((a, b) => a - b),
    insertRaw: (row: Omit<StoredRow, 'id'>) => {
      rows.push({ ...row, id: nextId++ })
    },
    duplicateAll: () => {
      for (const row of [...rows]) rows.push({ ...row, id: nextId++ })
    },
  }
}

const ENTITY_TYPE = 'sales:sales_order'

const payload = (
  recordId: string,
  doc: Record<string, unknown>,
  scope: { organizationId: string | null; tenantId: string | null } = { organizationId: 'org-1', tenantId: 'tenant-1' }
) => ({ entityType: ENTITY_TYPE, recordId, organizationId: scope.organizationId, tenantId: scope.tenantId, doc })

const hashOf = (word: string): string => tokenizeText(word, resolveSearchConfig()).hashes[0]

describe('replaceSearchTokensForBatch — skips records whose tokens have not changed', () => {
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
    await replaceSearchTokensForBatch(store.db, [payload('order-1', { title: 'alpha widget' })])
    // Vacuity guard: with search disabled the function returns early and every assertion below
    // would hold for the wrong reason.
    expect(store.rows.length).toBeGreaterThan(0)
    const idsBefore = store.rowIds()

    await replaceSearchTokensForBatch(store.db, [payload('order-1', { title: 'alpha widget' })])

    expect(store.rowIds()).toEqual(idsBefore)
    expect(store.transactionCount).toBe(1)
    expect(store.selectCount).toBe(2)
  })

  it('still rewrites a changed record, and the new value is searchable afterwards', async () => {
    const store = createSearchTokenStore()
    await replaceSearchTokensForBatch(store.db, [payload('order-1', { title: 'alpha widget' })])
    expect(store.rows.length).toBeGreaterThan(0)
    const idsBefore = new Set(store.rowIds())

    await replaceSearchTokensForBatch(store.db, [payload('order-1', { title: 'beta widget' })])

    expect(store.rows.length).toBeGreaterThan(0)
    expect(store.rowIds().some((id) => idsBefore.has(id))).toBe(false)
    expect(store.rows.some((row) => row.token_hash === hashOf('beta'))).toBe(true)
    expect(store.rows.some((row) => row.token_hash === hashOf('alpha'))).toBe(false)
    expect(store.transactionCount).toBe(2)
  })

  it('rewrites a record whose stored rows contain a token the document no longer produces', async () => {
    const store = createSearchTokenStore()
    await replaceSearchTokensForBatch(store.db, [payload('order-1', { title: 'alpha widget' })])
    const seededCount = store.rows.length
    expect(seededCount).toBeGreaterThan(0)
    store.insertRaw({
      entity_type: ENTITY_TYPE,
      entity_id: 'order-1',
      organization_id: 'org-1',
      tenant_id: 'tenant-1',
      field: 'title',
      token_hash: 'stale-hash',
      token: null,
    })

    await replaceSearchTokensForBatch(store.db, [payload('order-1', { title: 'alpha widget' })])

    expect(store.rows.some((row) => row.token_hash === 'stale-hash')).toBe(false)
    expect(store.rows.length).toBe(seededCount)
  })

  it('collapses duplicated stored rows instead of reading them as already correct', async () => {
    const store = createSearchTokenStore()
    await replaceSearchTokensForBatch(store.db, [payload('order-1', { title: 'alpha widget' })])
    const seededCount = store.rows.length
    expect(seededCount).toBeGreaterThan(0)
    store.duplicateAll()
    expect(store.rows.length).toBe(seededCount * 2)

    await replaceSearchTokensForBatch(store.db, [payload('order-1', { title: 'alpha widget' })])

    expect(store.rows.length).toBe(seededCount)
  })

  it('skips an unchanged record when raw tokens are stored, so a stored NULL is not the only case covered', async () => {
    process.env.OM_SEARCH_STORE_RAW_TOKENS = 'true'
    const store = createSearchTokenStore()
    await replaceSearchTokensForBatch(store.db, [payload('order-1', { title: 'alpha widget' })])
    expect(store.rows.length).toBeGreaterThan(0)
    expect(store.rows.every((row) => row.token !== null)).toBe(true)
    const idsBefore = store.rowIds()

    await replaceSearchTokensForBatch(store.db, [payload('order-1', { title: 'alpha widget' })])

    expect(store.rowIds()).toEqual(idsBefore)
    expect(store.transactionCount).toBe(1)
  })

  it('narrows the rewrite to the changed scope bucket', async () => {
    const store = createSearchTokenStore()
    const orgOne = { organizationId: 'org-1', tenantId: 'tenant-1' }
    const orgTwo = { organizationId: 'org-2', tenantId: 'tenant-2' }
    await replaceSearchTokensForBatch(store.db, [
      payload('order-1', { title: 'alpha widget' }, orgOne),
      payload('order-2', { title: 'gamma widget' }, orgTwo),
    ])
    expect(store.rowIds('order-1').length).toBeGreaterThan(0)
    expect(store.rowIds('order-2').length).toBeGreaterThan(0)
    const untouchedIds = store.rowIds('order-1')
    const rewrittenIds = new Set(store.rowIds('order-2'))

    await replaceSearchTokensForBatch(store.db, [
      payload('order-1', { title: 'alpha widget' }, orgOne),
      payload('order-2', { title: 'delta widget' }, orgTwo),
    ])

    expect(store.rowIds('order-1')).toEqual(untouchedIds)
    expect(store.rowIds('order-2').some((id) => rewrittenIds.has(id))).toBe(false)
    expect(store.rows.some((row) => row.token_hash === hashOf('delta'))).toBe(true)
  })

  it('deletes the stored rows of a record that no longer produces tokens', async () => {
    const store = createSearchTokenStore()
    await replaceSearchTokensForBatch(store.db, [
      payload('order-1', { title: 'alpha widget' }),
      payload('order-2', { title: 'gamma widget' }),
    ])
    expect(store.rowIds('order-1').length).toBeGreaterThan(0)
    const survivingIds = store.rowIds('order-2')
    expect(survivingIds.length).toBeGreaterThan(0)

    await replaceSearchTokensForBatch(store.db, [
      payload('order-1', { title: '' }),
      payload('order-2', { title: 'gamma widget' }),
    ])

    expect(store.rowIds('order-1')).toEqual([])
    expect(store.rowIds('order-2')).toEqual(survivingIds)
  })
})
