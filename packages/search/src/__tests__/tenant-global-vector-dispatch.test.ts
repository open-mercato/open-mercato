import { reindexEntity } from '@open-mercato/core/modules/query_index/lib/reindexer'
import { upsertIndexBatch } from '@open-mercato/core/modules/query_index/lib/batch'
import { resetTenantGlobalEntityTypes } from '@open-mercato/core/modules/query_index/lib/tenant-global'
import handleVectorUpsert from '../modules/search/subscribers/vector_upsert'
import handleVectorPurge from '../modules/search/subscribers/vector_purge'

jest.mock('@open-mercato/core/modules/query_index/lib/batch', () => {
  const actual = jest.requireActual('@open-mercato/core/modules/query_index/lib/batch')
  return { ...actual, upsertIndexBatch: jest.fn() }
})

jest.mock('@open-mercato/core/modules/query_index/lib/coverage', () => ({
  applyCoverageAdjustments: jest.fn(async () => undefined),
  refreshCoverageSnapshot: jest.fn(async () => undefined),
  writeCoverageCounts: jest.fn(async () => undefined),
  deleteScopedCoverageForEntity: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/core/modules/query_index/lib/jobs', () => ({
  prepareJob: jest.fn(async () => undefined),
  updateJobProgress: jest.fn(async () => undefined),
  finalizeJob: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/core/modules/query_index/lib/stale', () => ({
  purgeOrphans: jest.fn(async () => undefined),
  retireScopedCatalogueRows: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/indexers/status-log', () => ({
  recordIndexerLog: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/indexers/error-log', () => ({
  recordIndexerError: jest.fn(async () => undefined),
}))

jest.mock('../modules/search/lib/embedding-config', () => ({
  resolveEmbeddingConfig: jest.fn(async () => null),
}))

/**
 * A reindex of a declared platform-wide catalogue, wired to the real vector subscribers.
 *
 * The projection of such a catalogue is written under the null scope, but its vector work
 * cannot be: `vector_upsert` looks the missing tenant up in the source table - which has no
 * `tenant_id` column - and returns before enqueueing, and `vector_purge` returns at once for
 * a null tenant. Asserting the emitted payload alone cannot catch that, so the events here
 * go through the consumers and the assertions are on the work they actually queue.
 */

const CATALOGUE = 'feature_toggles:feature_toggle'
const TABLE = 'feature_toggles'
const TENANT = '0e40f2bf-a7ab-465c-8040-20abbd8ad398'
const ORG = 'b7c1c0f0-3d2b-4a91-9a4a-2f3f0a1b2c3d'
const TENANT_LESS_COLUMNS = ['id', 'identifier', 'name', 'description', 'default_value', 'created_at']

const mockUpsertIndexBatch = upsertIndexBatch as jest.MockedFunction<typeof upsertIndexBatch>

type Chain = Record<string, (...args: unknown[]) => unknown>

/** Fake Kysely for the sweep: answers the column probe and serves one page of records. */
function createSweepDb(rows: Array<{ id: string }>) {
  const pages = [rows, []]
  const chainFor = (target: string): Chain => {
    let isPageQuery = false
    const selected: string[] = []
    const chain: Chain = {
      select: (columns: unknown) => {
        for (const column of Array.isArray(columns) ? columns : [columns]) selected.push(String(column))
        return chain
      },
      selectAll: () => { isPageQuery = true; return chain },
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      groupBy: () => chain,
      set: () => chain,
      execute: async () => {
        if (target === 'information_schema.columns') return TENANT_LESS_COLUMNS.map((column_name) => ({ column_name }))
        if (target.startsWith(TABLE)) return pages.shift() ?? []
        return []
      },
      executeTakeFirst: async () => {
        if (target.startsWith(TABLE) && !isPageQuery) return { count: rows.length }
        if (target === 'entity_index_jobs') {
          return selected.some((column) => column.includes('started_at'))
            ? { started_at: new Date('2026-08-01T00:00:00Z') }
            : undefined
        }
        return undefined
      },
    }
    return chain
  }
  const deleteChain: Chain = {
    where: () => deleteChain,
    execute: async () => undefined,
  }
  return {
    selectFrom: (target: unknown) => chainFor(String(target)),
    insertInto: (target: unknown) => chainFor(String(target)),
    updateTable: (target: unknown) => chainFor(String(target)),
    deleteFrom: () => deleteChain,
  }
}

function createEm(db: unknown) {
  return {
    getKysely: () => db,
    fork() { return this },
    getMetadata: () => ({
      find: () => ({ tableName: TABLE }),
      getAll: () => [{ tableName: TABLE }],
    }),
  }
}

/**
 * The subscriber side of the wiring. Its scope lookup runs against the real shape of a
 * catalogue table: there is no `tenant_id` column to select, so the query fails.
 */
function createConsumers() {
  const lookupDb = {
    selectFrom: () => {
      const chain: Chain = {
        select: () => chain,
        where: () => chain,
        executeTakeFirst: async () => {
          throw new Error(`column "tenant_id" does not exist`)
        },
      }
      return chain
    },
  }
  const enqueue = jest.fn(async () => undefined)
  const purgeEntity = jest.fn(async () => undefined)
  const ctx = {
    resolve: <T = unknown>(name: string): T => {
      if (name === 'em') return createEm(lookupDb) as T
      if (name === 'vectorIndexQueue') return { enqueue } as T
      if (name === 'searchIndexer') return { purgeEntity } as T
      throw new Error(`not registered: ${name}`)
    },
  }
  const eventBus = {
    emitEvent: jest.fn(async (event: string, payload: Record<string, unknown>) => {
      if (event === 'query_index.vectorize_one') await handleVectorUpsert(payload, ctx)
      if (event === 'query_index.vectorize_purge') await handleVectorPurge(payload, ctx)
    }),
  }
  return { eventBus, enqueue, purgeEntity }
}

beforeEach(() => {
  jest.clearAllMocks()
  resetTenantGlobalEntityTypes()
  mockUpsertIndexBatch.mockResolvedValue({ attempted: 1, written: 1, failedRecordIds: [], searchTokenFailures: 0 })
})

afterAll(() => {
  resetTenantGlobalEntityTypes()
})

describe('vector work for a reindexed platform-wide catalogue reaches its consumers', () => {
  it('enqueues vector indexing for each record, under the tenant that ran the sweep', async () => {
    const { eventBus, enqueue } = createConsumers()
    const em = createEm(createSweepDb([{ id: 'toggle-1' }]))

    await reindexEntity(em as never, {
      entityType: CATALOGUE,
      tenantId: TENANT,
      organizationId: ORG,
      emitVectorizeEvents: true,
      eventBus,
    })

    expect(enqueue).toHaveBeenCalledWith({
      jobType: 'index',
      entityType: CATALOGUE,
      recordId: 'toggle-1',
      tenantId: TENANT,
      organizationId: ORG,
    })
  })

  it('performs the force reindex vector purge instead of skipping it', async () => {
    const { eventBus, purgeEntity } = createConsumers()
    const em = createEm(createSweepDb([{ id: 'toggle-1' }]))

    await reindexEntity(em as never, {
      entityType: CATALOGUE,
      tenantId: TENANT,
      organizationId: ORG,
      force: true,
      resetCoverage: true,
      emitVectorizeEvents: true,
      eventBus,
    })

    expect(purgeEntity).toHaveBeenCalledWith({ entityId: CATALOGUE, tenantId: TENANT, organizationId: ORG })
  })
})
