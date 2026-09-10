import type { Kysely } from 'kysely'
import { encryptWithAesGcm, generateDek } from '@open-mercato/shared/lib/encryption/aes'
import { resolveSearchConfig } from '@open-mercato/shared/lib/search/config'
import { tokenizeText } from '@open-mercato/shared/lib/search/tokenize'
import {
  buildSearchTokenRows,
  replaceSearchTokensForBatch,
  replaceSearchTokensForRecord,
  resetCiphertextSkipWarnings,
} from '../lib/search-tokens'

const warn = jest.fn()
jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: (...args: unknown[]) => warn(...args),
    error: jest.fn(),
    child: jest.fn(),
  }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})

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

type Matcher = (row: StoredRow) => boolean
type RawBuilderLike = { toOperationNode: () => { sqlFragments: string[]; parameters: Array<{ value?: unknown }> } }

const columnOf = (row: StoredRow, column: string): unknown => (row as unknown as Record<string, unknown>)[column]

/**
 * Minimal in-memory `search_tokens`, kin to the stores in `search-tokens-record-unchanged-skip`
 * and `search-tokens-unchanged-skip`. Rows carry a synthetic `id` because that is the only thing
 * that distinguishes "left alone" from "deleted and re-inserted with identical content", and the
 * whole point of this guard is that the existing rows are never deleted.
 */
function createStore() {
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

  const selectChain = () => (_table: unknown) => {
    const predicates: Matcher[] = []
    let columns: string[] | null = null
    let limit: number | null = null
    let grouped = false
    const chain: any = {
      select: (selection: unknown) => {
        columns = Array.isArray(selection) ? selection.filter((col) => typeof col === 'string').map(String) : null
        return chain
      },
      where: (...args: unknown[]) => {
        predicates.push(buildPredicate(args))
        return chain
      },
      groupBy: () => {
        grouped = true
        return chain
      },
      limit: (count: number) => {
        limit = count
        return chain
      },
      execute: async () => {
        const matched = rows.filter((row) => predicates.every((matches) => matches(row)))
        if (grouped) {
          const counts = new Map<string, number>()
          for (const row of matched) counts.set(row.entity_id, (counts.get(row.entity_id) ?? 0) + 1)
          return Array.from(counts, ([entity_id, token_count]) => ({ entity_id, token_count: String(token_count) }))
        }
        if (!columns) return [{ token_count: String(matched.length) }]
        const limited = limit === null ? matched : matched.slice(0, limit)
        return limited.map((row) => Object.fromEntries(columns!.map((column) => [column, columnOf(row, column)])))
      },
    }
    return chain
  }

  const deleteChain = (_table: unknown) => {
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

  const insertChain = (_table: unknown) => {
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

  const executor = () => ({ selectFrom: selectChain(), deleteFrom: deleteChain, insertInto: insertChain })

  const db = {
    ...executor(),
    transaction: () => ({
      execute: async (callback: (trx: unknown) => Promise<void>) => callback(executor()),
    }),
  } as unknown as Kysely<any>

  return {
    db,
    rows,
    insertRaw: (row: Omit<StoredRow, 'id'>) => {
      rows.push({ ...row, id: nextId++ })
    },
    idsFor: (field: string) => rows.filter((row) => row.field === field).map((row) => row.id).sort((a, b) => a - b),
    fields: () => Array.from(new Set(rows.map((row) => row.field))).sort(),
  }
}

const ENTITY_TYPE = 'customers:customer_deal'
const SCOPE = { organizationId: 'org-1', tenantId: 'tenant-1' }
const hashOf = (word: string): string => tokenizeText(word, resolveSearchConfig()).hashes[0]

const storedRow = (recordId: string, field: string, tokenHash: string): Omit<StoredRow, 'id'> => ({
  entity_type: ENTITY_TYPE,
  entity_id: recordId,
  organization_id: SCOPE.organizationId,
  tenant_id: SCOPE.tenantId,
  field,
  token_hash: tokenHash,
  token: null,
})

const ciphertext = () => String(encryptWithAesGcm('Renewal for ACME Ltd', generateDek()).value)

beforeEach(() => {
  warn.mockClear()
  resetCiphertextSkipWarnings()
})

/**
 * The failure this guards against is not "search degrades while encryption is off" — it is
 * permanent, silent data loss.
 *
 * Tokens are hashes of PLAINTEXT: the indexer decrypts a document before tokenising it, which is
 * what lets the token index survive encryption being switched on or off. That decrypt step becomes
 * a no-op under `TENANT_DATA_ENCRYPTION=no`, so an operator who flips the toggle before running
 * `mercato entities decrypt-database` feeds ciphertext to the tokeniser. Writing those tokens is
 * merely useless; DELETING the good ones to make room for them is unrecoverable without a reindex
 * that itself cannot run until the data is decrypted.
 */
describe('search tokens refuse to index ciphertext', () => {
  it('emits no token rows for a field holding an AES-GCM envelope', () => {
    const rows = buildSearchTokenRows({
      entityType: ENTITY_TYPE,
      recordId: 'deal-1',
      ...SCOPE,
      doc: { title: ciphertext(), status: 'open' },
    })

    expect(new Set(rows.map((row) => row.field))).toEqual(new Set(['status']))
  })

  it('indexes the plaintext siblings of a ciphertext field normally', () => {
    const rows = buildSearchTokenRows({
      entityType: ENTITY_TYPE,
      recordId: 'deal-1',
      ...SCOPE,
      doc: { title: ciphertext(), description: 'quarterly renewal' },
    })

    expect(rows.length).toBeGreaterThan(0)
    expect(new Set(rows.map((row) => row.field))).toEqual(new Set(['description']))
  })

  it('skips an array field as soon as any entry is an envelope', () => {
    const rows = buildSearchTokenRows({
      entityType: ENTITY_TYPE,
      recordId: 'deal-1',
      ...SCOPE,
      doc: { tags: ['plaintext', ciphertext()] },
    })

    expect(rows).toEqual([])
  })

  it('tells the operator which fields and what to do about it, once per entity type', () => {
    const doc = { title: ciphertext(), description: ciphertext() }
    buildSearchTokenRows({ entityType: ENTITY_TYPE, recordId: 'deal-1', ...SCOPE, doc })
    buildSearchTokenRows({ entityType: ENTITY_TYPE, recordId: 'deal-2', ...SCOPE, doc })

    // Once per entity type per process: a full reindex would otherwise emit this per record.
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('decrypt-database')
    expect(warn.mock.calls[0][1]).toEqual({ entityType: ENTITY_TYPE, fields: ['description', 'title'] })
  })
})

describe('replaceSearchTokensForRecord preserves tokens for ciphertext fields', () => {
  it('leaves the encrypted field’s existing rows untouched while rewriting its siblings', async () => {
    const store = createStore()
    store.insertRaw(storedRow('deal-1', 'title', hashOf('renewal')))
    store.insertRaw(storedRow('deal-1', 'description', hashOf('stale')))
    const preservedIds = store.idsFor('title')

    await replaceSearchTokensForRecord(store.db, {
      entityType: ENTITY_TYPE,
      recordId: 'deal-1',
      ...SCOPE,
      doc: { title: ciphertext(), description: 'quarterly renewal' },
    })

    // Same row ids => never deleted. A delete-then-reinsert would renumber them.
    expect(store.idsFor('title')).toEqual(preservedIds)
    expect(store.rows.filter((row) => row.field === 'title').map((row) => row.token_hash))
      .toEqual([hashOf('renewal')])
    // The plaintext sibling still gets its normal rewrite.
    expect(store.rows.some((row) => row.field === 'description' && row.token_hash === hashOf('quarterly')))
      .toBe(true)
    expect(store.rows.some((row) => row.token_hash === hashOf('stale'))).toBe(false)
  })

  it('does not strand a record whose every indexable field is ciphertext', async () => {
    const store = createStore()
    store.insertRaw(storedRow('deal-1', 'title', hashOf('renewal')))
    const preservedIds = store.idsFor('title')

    await replaceSearchTokensForRecord(store.db, {
      entityType: ENTITY_TYPE,
      recordId: 'deal-1',
      ...SCOPE,
      doc: { title: ciphertext() },
    })

    expect(store.idsFor('title')).toEqual(preservedIds)
  })
})

describe('replaceSearchTokensForBatch preserves tokens for ciphertext records', () => {
  it('drops the affected record from the rewrite and still processes its neighbours', async () => {
    const store = createStore()
    store.insertRaw(storedRow('deal-encrypted', 'title', hashOf('renewal')))
    store.insertRaw(storedRow('deal-plain', 'title', hashOf('outdated')))
    const preservedIds = store.idsFor('title').slice(0, 1)

    await replaceSearchTokensForBatch(store.db, [
      { entityType: ENTITY_TYPE, recordId: 'deal-encrypted', ...SCOPE, doc: { title: ciphertext() } },
      { entityType: ENTITY_TYPE, recordId: 'deal-plain', ...SCOPE, doc: { title: 'quarterly renewal' } },
    ])

    const encryptedRows = store.rows.filter((row) => row.entity_id === 'deal-encrypted')
    expect(encryptedRows.map((row) => row.id)).toEqual(preservedIds)
    expect(encryptedRows.map((row) => row.token_hash)).toEqual([hashOf('renewal')])

    const plainHashes = store.rows.filter((row) => row.entity_id === 'deal-plain').map((row) => row.token_hash)
    expect(plainHashes).toContain(hashOf('quarterly'))
    expect(plainHashes).not.toContain(hashOf('outdated'))
  })

  it('does not purge a batch of nothing-but-ciphertext records', async () => {
    const store = createStore()
    store.insertRaw(storedRow('deal-1', 'title', hashOf('renewal')))
    store.insertRaw(storedRow('deal-2', 'title', hashOf('expansion')))
    const before = store.rows.map((row) => row.id).sort((a, b) => a - b)

    // The `!rows.length` branch purges every id in the batch. Reaching it with these records would
    // wipe exactly the tokens that are still good.
    await replaceSearchTokensForBatch(store.db, [
      { entityType: ENTITY_TYPE, recordId: 'deal-1', ...SCOPE, doc: { title: ciphertext() } },
      { entityType: ENTITY_TYPE, recordId: 'deal-2', ...SCOPE, doc: { title: ciphertext() } },
    ])

    expect(store.rows.map((row) => row.id).sort((a, b) => a - b)).toEqual(before)
  })
})
