import { reindexEntity } from '../lib/reindexer'
import { upsertIndexBatch, type UpsertIndexBatchResult } from '../lib/batch'
import { decryptIndexDocForSearch } from '@open-mercato/shared/lib/encryption/indexDoc'

jest.mock('../lib/batch', () => {
  const actual = jest.requireActual('../lib/batch')
  return { ...actual, upsertIndexBatch: jest.fn() }
})

jest.mock('@open-mercato/shared/lib/encryption/indexDoc', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/encryption/indexDoc')
  return { ...actual, decryptIndexDocForSearch: jest.fn() }
})

jest.mock('../lib/coverage', () => ({
  applyCoverageAdjustments: jest.fn(async () => undefined),
  refreshCoverageSnapshot: jest.fn(async () => undefined),
  writeCoverageCounts: jest.fn(async () => undefined),
}))

jest.mock('../lib/jobs', () => ({
  prepareJob: jest.fn(async () => undefined),
  updateJobProgress: jest.fn(async () => undefined),
  finalizeJob: jest.fn(async () => undefined),
}))

jest.mock('../lib/stale', () => ({
  purgeOrphans: jest.fn(async () => undefined),
}))

const mockUpsertIndexBatch = upsertIndexBatch as jest.MockedFunction<typeof upsertIndexBatch>
const mockDecrypt = decryptIndexDocForSearch as jest.MockedFunction<typeof decryptIndexDocForSearch>

function batchResult(partial: Partial<UpsertIndexBatchResult>): UpsertIndexBatchResult {
  return { attempted: 0, written: 0, failedRecordIds: [], searchTokenFailures: 0, ...partial }
}

function createFakeDb(pages: Array<Array<{ id: string }>>) {
  const remainingPages = [...pages, []]
  const baseTableSelects: string[] = []

  const chainFor = (table: string): any => {
    let isPageQuery = false
    const chain: any = {
      select: () => chain,
      selectAll: () => { isPageQuery = true; return chain },
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      groupBy: () => chain,
      set: () => chain,
      execute: async () => {
        // `todos` carries `tenant_id` / `organization_id`; the reindexer refuses a
        // tenant-scoped sweep of a table whose column probe reports no tenant
        // column, so the probe has to answer with the real shape.
        if (table === 'information_schema.columns') {
          return ['id', 'tenant_id', 'organization_id', 'deleted_at'].map((column_name) => ({ column_name }))
        }
        if (table.startsWith('todos')) {
          baseTableSelects.push(table)
          return remainingPages.shift() ?? []
        }
        return []
      },
      executeTakeFirst: async () => {
        if (table.startsWith('todos') && !isPageQuery) {
          return { count: pages.reduce((acc, page) => acc + page.length, 0) }
        }
        if (table === 'entity_index_jobs') return { started_at: new Date('2026-07-01T00:00:00Z') }
        return undefined
      },
    }
    return chain
  }

  const db: any = {
    selectFrom: (table: unknown) => chainFor(String(table)),
    insertInto: (table: unknown) => chainFor(String(table)),
    updateTable: (table: unknown) => chainFor(String(table)),
    deleteFrom: (table: unknown) => chainFor(String(table)),
  }
  return { db, baseTableSelects }
}

function makeEm(pages: Array<Array<{ id: string }>>) {
  const { db, baseTableSelects } = createFakeDb(pages)
  const em: any = {
    getKysely: () => db,
    getMetadata: () => ({
      find: (className: string) => (className === 'Todo' ? { tableName: 'todos' } : undefined),
      getAll: () => [{ className: 'Todo', tableName: 'todos' }],
    }),
  }
  return { em, baseTableSelects }
}

const OPTIONS = { entityType: 'example:todo', tenantId: 't1', organizationId: 'o1', force: true }
const SCOPE = { tenantId: 't1', organizationId: 'o1' }

type DekCache = Map<string | null, string | null>

function decryptRowsTwice() {
  mockUpsertIndexBatch.mockImplementation(async (_db, _entityType, rows, _overrides, opts) => {
    await opts!.decryptDoc!('example:todo', { id: '1' }, SCOPE)
    await opts!.decryptDoc!('example:todo', { id: '2' }, SCOPE)
    return batchResult({ attempted: rows.length, written: rows.length })
  })
}

describe('reindexEntity custom-field DEK cache between batch rows', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('retries a key lookup that failed on an earlier row', async () => {
    const cacheStateBeforeEachRow: boolean[] = []
    mockDecrypt.mockImplementation(async (_entity, doc, _scope, _service, cache) => {
      const dekCache = cache as DekCache
      cacheStateBeforeEachRow.push(dekCache.has('t1'))
      dekCache.set('t1', null)
      return doc
    })
    decryptRowsTwice()
    const { em } = makeEm([[{ id: '1' }, { id: '2' }]])

    await reindexEntity(em, OPTIONS)

    expect(mockDecrypt).toHaveBeenCalledTimes(2)
    expect(cacheStateBeforeEachRow).toEqual([false, false])
  })

  it('keeps a successfully resolved key cached for the next row', async () => {
    const cachedKeyBeforeEachRow: Array<string | null | undefined> = []
    mockDecrypt.mockImplementation(async (_entity, doc, _scope, _service, cache) => {
      const dekCache = cache as DekCache
      cachedKeyBeforeEachRow.push(dekCache.get('t1'))
      dekCache.set('t1', 'resolved-key')
      return doc
    })
    decryptRowsTwice()
    const { em } = makeEm([[{ id: '1' }, { id: '2' }]])

    await reindexEntity(em, OPTIONS)

    expect(cachedKeyBeforeEachRow).toEqual([undefined, 'resolved-key'])
  })
})
