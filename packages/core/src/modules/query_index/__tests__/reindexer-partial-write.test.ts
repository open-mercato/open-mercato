import { reindexEntity } from '../lib/reindexer'
import { upsertIndexBatch, QueryIndexBatchWriteError, type UpsertIndexBatchResult } from '../lib/batch'
import { applyCoverageAdjustments, refreshCoverageSnapshot, writeCoverageCounts } from '../lib/coverage'
import { finalizeJob, prepareJob, updateJobProgress } from '../lib/jobs'
import { purgeOrphans } from '../lib/stale'

jest.mock('../lib/batch', () => {
  const actual = jest.requireActual('../lib/batch')
  return { ...actual, upsertIndexBatch: jest.fn() }
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
const mockApplyCoverageAdjustments = applyCoverageAdjustments as jest.MockedFunction<typeof applyCoverageAdjustments>
const mockRefreshCoverageSnapshot = refreshCoverageSnapshot as jest.MockedFunction<typeof refreshCoverageSnapshot>
const mockUpdateJobProgress = updateJobProgress as jest.MockedFunction<typeof updateJobProgress>
const mockFinalizeJob = finalizeJob as jest.MockedFunction<typeof finalizeJob>
const mockPurgeOrphans = purgeOrphans as jest.MockedFunction<typeof purgeOrphans>

function batchResult(partial: Partial<UpsertIndexBatchResult>): UpsertIndexBatchResult {
  return { attempted: 0, written: 0, failedRecordIds: [], searchTokenFailures: 0, ...partial }
}

/**
 * Fake Kysely for the reindex loop: serves the base-table count, then the record pages
 * (one page per queued array, terminating with an empty page), and stubs the job row.
 */
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

describe('reindexEntity write reconciliation (GSM-266)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('completes the run, then fails it when a record was lost', async () => {
    const { em } = makeEm([[{ id: '1' }, { id: '2' }, { id: '3' }]])
    mockUpsertIndexBatch.mockResolvedValue(batchResult({ attempted: 3, written: 2, failedRecordIds: ['2'] }))

    await expect(reindexEntity(em, OPTIONS)).rejects.toThrow(QueryIndexBatchWriteError)

    // Coverage is credited only for what actually landed.
    expect(mockApplyCoverageAdjustments).toHaveBeenCalledWith(
      em,
      [expect.objectContaining({ deltaIndex: 2 })],
    )
    expect(mockUpdateJobProgress).toHaveBeenCalledWith(expect.anything(), expect.anything(), 2)

    // The failed record keeps its existing index row instead of being purged away.
    expect(mockPurgeOrphans).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ excludeRecordIds: ['2'] }),
    )

    // The authoritative recount still runs, so reported coverage stays truthful.
    expect(mockRefreshCoverageSnapshot).toHaveBeenCalled()
    // Finished, but recorded as failed — finished_at alone reads as "completed".
    expect(mockFinalizeJob).toHaveBeenCalledWith(expect.anything(), expect.anything(), { status: 'failed' })
  })

  it('aborts immediately when a whole batch fails, without scanning the rest of the table', async () => {
    const { em, baseTableSelects } = makeEm([[{ id: '1' }, { id: '2' }], [{ id: '3' }, { id: '4' }]])
    mockUpsertIndexBatch.mockResolvedValue(batchResult({ attempted: 2, written: 0, failedRecordIds: ['1', '2'] }))

    await expect(reindexEntity(em, OPTIONS)).rejects.toThrow(QueryIndexBatchWriteError)

    expect(mockUpsertIndexBatch).toHaveBeenCalledTimes(1)
    expect(baseTableSelects).toHaveLength(1)
    expect(mockPurgeOrphans).not.toHaveBeenCalled()
    // Still finalized, otherwise the scope stays wedged behind the active-job guard.
    expect(mockFinalizeJob).toHaveBeenCalledWith(expect.anything(), expect.anything(), { status: 'failed' })
  })

  it('leaves the happy path untouched', async () => {
    const { em } = makeEm([[{ id: '1' }, { id: '2' }, { id: '3' }]])
    mockUpsertIndexBatch.mockResolvedValue(batchResult({ attempted: 3, written: 3 }))

    const result = await reindexEntity(em, OPTIONS)

    expect(result.processed).toBe(3)
    expect(mockApplyCoverageAdjustments).toHaveBeenCalledWith(
      em,
      [expect.objectContaining({ deltaIndex: 3 })],
    )
    expect(mockPurgeOrphans).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ excludeRecordIds: [] }),
    )
    expect(mockRefreshCoverageSnapshot).toHaveBeenCalled()
    expect(writeCoverageCounts).toHaveBeenCalled()
    expect(prepareJob).toHaveBeenCalled()
    expect(mockFinalizeJob).toHaveBeenCalledWith(expect.anything(), expect.anything(), {})
  })
})
