import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
} from 'kysely'
import { reindexEntity } from '../lib/reindexer'
import { upsertIndexBatch, type UpsertIndexBatchResult } from '../lib/batch'

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

function batchResult(partial: Partial<UpsertIndexBatchResult>): UpsertIndexBatchResult {
  return { attempted: 0, written: 0, failedRecordIds: [], searchTokenFailures: 0, ...partial }
}

/**
 * A Kysely bound to a driver that records every compiled statement, so assertions can
 * read the real SQL the reindexer emits instead of a hand-rolled chain stub.
 */
function makeEm(rows: Array<{ id: string }>) {
  const statements: CompiledQuery[] = []
  let pageServed = false

  const respond = (compiled: CompiledQuery): { rows: unknown[] } => {
    const text = compiled.sql
    if (text.includes('information_schema')) {
      return { rows: [{ column_name: 'id' }, { column_name: 'tenant_id' }, { column_name: 'organization_id' }] }
    }
    if (text.includes('entity_index_jobs')) {
      return { rows: [{ started_at: new Date('2026-08-01T00:00:00Z') }] }
    }
    if (text.startsWith('select count(*)') || text.includes('count(*)')) {
      return { rows: [{ count: rows.length }] }
    }
    if (text.startsWith('select * from "todos"')) {
      if (pageServed) return { rows: [] }
      pageServed = true
      return { rows }
    }
    return { rows: [] }
  }

  const db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => ({
        init: async () => undefined,
        acquireConnection: async () => ({
          executeQuery: async (compiled: CompiledQuery) => {
            statements.push(compiled)
            const result = respond(compiled)
            return { rows: result.rows, numAffectedRows: BigInt(0) }
          },
          streamQuery: async function* () { /* not used */ },
        }),
        beginTransaction: async () => undefined,
        commitTransaction: async () => undefined,
        rollbackTransaction: async () => undefined,
        releaseConnection: async () => undefined,
        destroy: async () => undefined,
      }),
      createIntrospector: (instance: Kysely<any>) => new PostgresIntrospector(instance),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  })

  const em: any = {
    getKysely: () => db,
    getMetadata: () => ({
      find: (className: string) => (className === 'Todo' ? { tableName: 'todos' } : undefined),
      getAll: () => [{ className: 'Todo', tableName: 'todos' }],
    }),
  }
  return { em, statements }
}

function purgeStatements(statements: CompiledQuery[]): CompiledQuery[] {
  return statements.filter((entry) => entry.sql.startsWith('delete from "entity_indexes"'))
}

const BASE_OPTIONS = { entityType: 'example:todo', tenantId: 't1', force: true }

describe('reindexEntity force purge scoping', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUpsertIndexBatch.mockResolvedValue(batchResult({ attempted: 1, written: 1 }))
  })

  // Regression: partition 0 used to purge the whole scope while its siblings were already
  // inserting, deleting their rows for good. The run still reported success because progress
  // counts attempted writes, so a fresh `mercato init` silently left entities under-indexed.
  it('restricts the purge to the partition being rebuilt', async () => {
    const { em, statements } = makeEm([{ id: 'a' }])

    await reindexEntity(em, { ...BASE_OPTIONS, partitionCount: 5, partitionIndex: 0, resetCoverage: true })

    const purges = purgeStatements(statements)
    expect(purges).toHaveLength(1)
    expect(purges[0]!.sql).toMatch(/mod\(abs\(hashtext\(entity_id::text\)\), \$\d+\) = \$\d+/)
    expect(purges[0]!.parameters).toEqual(expect.arrayContaining([5, 0]))
  })

  it('purges in every partition, not only the coverage-resetting one', async () => {
    const { em, statements } = makeEm([{ id: 'b' }])

    await reindexEntity(em, { ...BASE_OPTIONS, partitionCount: 5, partitionIndex: 3, resetCoverage: false })

    const purges = purgeStatements(statements)
    expect(purges).toHaveLength(1)
    expect(purges[0]!.parameters).toEqual(expect.arrayContaining([5, 3]))
  })

  it('keeps the unpartitioned purge scope-wide', async () => {
    const { em, statements } = makeEm([{ id: 'c' }])

    await reindexEntity(em, { ...BASE_OPTIONS, resetCoverage: true })

    const purges = purgeStatements(statements)
    expect(purges).toHaveLength(1)
    expect(purges[0]!.sql).not.toContain('hashtext')
  })

  it('does not purge when the run is not forced', async () => {
    const { em, statements } = makeEm([{ id: 'd' }])

    await reindexEntity(em, { ...BASE_OPTIONS, force: false, resetCoverage: true })

    expect(purgeStatements(statements)).toHaveLength(0)
  })
})

// The vector purge deletes every vector for the scope and cannot be partitioned, so
// emitting it from inside a concurrent fan-out is the same race the row purge had — it
// would drop vectors the sibling partitions had just queued. The caller that owns the
// fan-out queues it once instead.
describe('reindexEntity vector purge scoping', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUpsertIndexBatch.mockResolvedValue(batchResult({ attempted: 1, written: 1 }))
  })

  function makeBus() {
    const emitted: string[] = []
    return {
      emitted,
      bus: { emitEvent: jest.fn(async (event: string) => { emitted.push(event) }) },
    }
  }

  it('does not emit a scope-wide vector purge from a partition', async () => {
    const { em } = makeEm([{ id: 'a' }])
    const { bus, emitted } = makeBus()

    await reindexEntity(em, {
      ...BASE_OPTIONS,
      partitionCount: 5,
      partitionIndex: 0,
      resetCoverage: true,
      emitVectorizeEvents: true,
      eventBus: bus,
    })

    expect(emitted).not.toContain('query_index.vectorize_purge')
  })

  it('still emits it for an unpartitioned forced run', async () => {
    const { em } = makeEm([{ id: 'a' }])
    const { bus, emitted } = makeBus()

    await reindexEntity(em, {
      ...BASE_OPTIONS,
      resetCoverage: true,
      emitVectorizeEvents: true,
      eventBus: bus,
    })

    expect(emitted).toContain('query_index.vectorize_purge')
  })
})
