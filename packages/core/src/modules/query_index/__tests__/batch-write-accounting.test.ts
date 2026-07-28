import { recordIndexerError } from '@open-mercato/shared/lib/indexers/error-log'
import { replaceSearchTokensForBatch } from '../lib/search-tokens'
import {
  upsertIndexBatch,
  assertIndexBatchWritesLanded,
  QueryIndexBatchWriteError,
  type AnyRow,
} from '../lib/batch'

jest.mock('@open-mercato/shared/lib/indexers/error-log', () => ({
  recordIndexerError: jest.fn(async () => undefined),
}))

jest.mock('../lib/search-tokens', () => ({
  replaceSearchTokensForBatch: jest.fn(async () => undefined),
  isSearchDebugEnabled: () => false,
}))

const mockRecordIndexerError = recordIndexerError as jest.MockedFunction<typeof recordIndexerError>
const mockReplaceSearchTokens = replaceSearchTokensForBatch as jest.MockedFunction<typeof replaceSearchTokensForBatch>

type InsertCall = { table: string; onConflict: boolean; values: any }

type FakeDbConfig = {
  /** Error thrown by the bulk `INSERT ... ON CONFLICT` statement. */
  bulkError?: unknown
  /** Error thrown by the per-row fallback insert for a given record id. */
  rowInsertError?: (entityId: string) => unknown | undefined
  /** Whether the per-row UPDATE matches an existing row, per record id and attempt number. */
  updateMatches?: (entityId: string, attempt: number) => boolean
}

/**
 * Minimal Kysely test double. Distinguishes the bulk upsert (which calls `onConflict`)
 * from the per-row fallback inserts, records which record ids actually reached the
 * database, and blows up if anything opens a transaction.
 */
function createFakeDb(config: FakeDbConfig = {}) {
  const inserts: InsertCall[] = []
  const writtenIds: string[] = []
  const updateAttempts = new Map<string, number>()
  let transactionCalls = 0

  const makeOcStub = (): any => {
    const oc: any = {
      columns: () => oc,
      doUpdateSet: () => oc,
      doNothing: () => oc,
    }
    return oc
  }

  const selectChain = (): any => {
    const chain: any = {
      select: () => chain,
      selectAll: () => chain,
      where: () => chain,
      execute: async () => [],
      executeTakeFirst: async () => undefined,
    }
    return chain
  }

  const insertChain = (table: string): any => {
    const call: InsertCall = { table, onConflict: false, values: undefined }
    const chain: any = {
      values: (values: any) => {
        call.values = values
        return chain
      },
      onConflict: (cb: unknown) => {
        call.onConflict = true
        if (typeof cb === 'function') {
          try { (cb as (oc: any) => unknown)(makeOcStub()) } catch { /* builder shape only */ }
        }
        return chain
      },
      execute: async () => {
        inserts.push(call)
        if (call.onConflict) {
          if (config.bulkError) throw config.bulkError
          for (const row of call.values as any[]) writtenIds.push(String(row.entity_id))
          return []
        }
        const entityId = String(call.values.entity_id)
        const error = config.rowInsertError?.(entityId)
        if (error) throw error
        writtenIds.push(entityId)
        return []
      },
    }
    return chain
  }

  const updateChain = (): any => {
    const wheres: any[][] = []
    const chain: any = {
      set: () => chain,
      where: (...args: any[]) => {
        wheres.push(args)
        return chain
      },
      executeTakeFirst: async () => {
        const idWhere = wheres.find((where) => where[0] === 'entity_id')
        const entityId = idWhere ? String(idWhere[2]) : ''
        const attempt = (updateAttempts.get(entityId) ?? 0) + 1
        updateAttempts.set(entityId, attempt)
        const matched = config.updateMatches?.(entityId, attempt) ?? false
        if (matched) writtenIds.push(entityId)
        return { numUpdatedRows: matched ? BigInt(1) : BigInt(0) }
      },
    }
    return chain
  }

  const db: any = {
    selectFrom: () => selectChain(),
    insertInto: (table: unknown) => insertChain(String(table)),
    updateTable: () => updateChain(),
    deleteFrom: () => updateChain(),
    transaction: () => {
      transactionCalls += 1
      throw new Error('the per-row fallback must not run inside a transaction')
    },
  }

  return {
    db,
    inserts,
    writtenIds,
    get transactionCalls() { return transactionCalls },
  }
}

function makeRows(ids: string[]): AnyRow[] {
  return ids.map((id) => ({ id, title: `record ${id}`, organization_id: 'org-1', tenant_id: 'tenant-1' }))
}

const SCOPE = { orgId: 'org-1', tenantId: 'tenant-1' }

describe('upsertIndexBatch write accounting (GSM-266)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockReplaceSearchTokens.mockResolvedValue(undefined as never)
  })

  it('reports every row written on the happy bulk path', async () => {
    const fake = createFakeDb()

    const result = await upsertIndexBatch(fake.db, 'example:todo', makeRows(['1', '2', '3']), SCOPE)

    expect(result).toEqual({ attempted: 3, written: 3, failedRecordIds: [], searchTokenFailures: 0 })
    expect(fake.writtenIds).toEqual(['1', '2', '3'])
    expect(mockRecordIndexerError).not.toHaveBeenCalled()
  })

  it('records the bulk failure and still writes every row through the fallback', async () => {
    const fake = createFakeDb({ bulkError: new Error('bulk upsert exploded') })

    const result = await upsertIndexBatch(fake.db, 'example:todo', makeRows(['1', '2', '3']), SCOPE)

    expect(result.written).toBe(3)
    expect(result.attempted).toBe(3)
    expect(result.failedRecordIds).toEqual([])
    expect(fake.writtenIds).toEqual(['1', '2', '3'])
    expect(mockRecordIndexerError).toHaveBeenCalledTimes(1)
    expect(mockRecordIndexerError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ handler: 'query_index:reindex-batch:bulk', source: 'query_index' }),
    )
  })

  // The regression that let a record vanish in production: the fallback used to run
  // inside a transaction, so one failing row aborted it and every sibling row was
  // silently rolled back at COMMIT while this function reported success.
  it('keeps writing the remaining rows after one row fails', async () => {
    const fake = createFakeDb({
      bulkError: new Error('bulk upsert exploded'),
      rowInsertError: (entityId) => (entityId === '2' ? new Error('invalid input syntax for type uuid: ""') : undefined),
    })

    const result = await upsertIndexBatch(fake.db, 'example:todo', makeRows(['1', '2', '3']), SCOPE)

    expect(result.written).toBe(2)
    expect(result.attempted).toBe(3)
    expect(result.failedRecordIds).toEqual(['2'])
    expect(fake.writtenIds).toEqual(['1', '3'])
    expect(fake.transactionCalls).toBe(0)
    expect(mockRecordIndexerError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ handler: 'query_index:reindex-batch:row', recordId: '2' }),
    )
    expect(mockReplaceSearchTokens).toHaveBeenCalledWith(
      expect.anything(),
      [expect.objectContaining({ recordId: '1' }), expect.objectContaining({ recordId: '3' })],
    )
  })

  it('counts a row as written when a concurrent insert race resolves via the update retry', async () => {
    const duplicateKeyError = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })
    const fake = createFakeDb({
      bulkError: new Error('bulk upsert exploded'),
      rowInsertError: (entityId) => (entityId === '2' ? duplicateKeyError : undefined),
      // The concurrent writer's row only exists on the retry.
      updateMatches: (entityId, attempt) => entityId === '2' && attempt === 2,
    })

    const result = await upsertIndexBatch(fake.db, 'example:todo', makeRows(['1', '2', '3']), SCOPE)

    expect(result.written).toBe(3)
    expect(result.failedRecordIds).toEqual([])
    expect(mockRecordIndexerError).toHaveBeenCalledTimes(1) // the bulk failure only
  })

  it('fails a row whose unique violation cannot be resolved by the update retry', async () => {
    const duplicateKeyError = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })
    const fake = createFakeDb({
      bulkError: new Error('bulk upsert exploded'),
      rowInsertError: (entityId) => (entityId === '2' ? duplicateKeyError : undefined),
    })

    const result = await upsertIndexBatch(fake.db, 'example:todo', makeRows(['1', '2', '3']), SCOPE)

    expect(result.written).toBe(2)
    expect(result.failedRecordIds).toEqual(['2'])
  })

  it('skips a row whose document cannot be encrypted instead of indexing it in plaintext', async () => {
    const fake = createFakeDb()
    const encryptDoc = jest.fn(async (_entityType: string, doc: Record<string, unknown>) => {
      if (doc.id === '2') throw new Error('DEK unavailable')
      return doc
    })

    const result = await upsertIndexBatch(fake.db, 'example:todo', makeRows(['1', '2', '3']), SCOPE, { encryptDoc })

    expect(result.attempted).toBe(3)
    expect(result.written).toBe(2)
    expect(result.failedRecordIds).toEqual(['2'])

    const bulkInsert = fake.inserts.find((call) => call.onConflict)
    expect(bulkInsert?.values.map((row: any) => row.entity_id)).toEqual(['1', '3'])
    expect(mockReplaceSearchTokens).toHaveBeenCalledWith(
      expect.anything(),
      [expect.objectContaining({ recordId: '1' }), expect.objectContaining({ recordId: '3' })],
    )
  })

  it('reports a search token failure without failing the indexed rows', async () => {
    const fake = createFakeDb()
    mockReplaceSearchTokens.mockRejectedValueOnce(new Error('token write failed'))

    const result = await upsertIndexBatch(fake.db, 'example:todo', makeRows(['1', '2']), SCOPE)

    expect(result.written).toBe(2)
    expect(result.failedRecordIds).toEqual([])
    expect(result.searchTokenFailures).toBe(1)
    expect(mockRecordIndexerError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: 'fulltext' }),
    )
  })

  it('returns an empty result for an empty batch', async () => {
    const fake = createFakeDb()

    const result = await upsertIndexBatch(fake.db, 'example:todo', [], SCOPE)

    expect(result).toEqual({ attempted: 0, written: 0, failedRecordIds: [], searchTokenFailures: 0 })
  })
})

describe('assertIndexBatchWritesLanded', () => {
  it('passes when every attempted row landed', () => {
    expect(() => assertIndexBatchWritesLanded('example:todo', {
      attempted: 3, written: 3, failedRecordIds: [], searchTokenFailures: 0,
    })).not.toThrow()
  })

  it('throws a typed error naming the lost records', () => {
    expect(() => assertIndexBatchWritesLanded('example:todo', {
      attempted: 3, written: 2, failedRecordIds: ['2'], searchTokenFailures: 0,
    })).toThrow(QueryIndexBatchWriteError)

    try {
      assertIndexBatchWritesLanded('example:todo', {
        attempted: 3, written: 2, failedRecordIds: ['2'], searchTokenFailures: 0,
      })
    } catch (error) {
      const typed = error as QueryIndexBatchWriteError
      expect(typed.message).toContain('example:todo')
      expect(typed.message).toContain('wrote 2 of 3 records')
      expect(typed.failedRecordIds).toEqual(['2'])
    }
  })
})
