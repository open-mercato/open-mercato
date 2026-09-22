/** @jest-environment node */

// An entity type switched off with `queryIndex.project = false` must stay out of
// `entity_indexes` on *every* write path, and the engine must answer it as "not
// indexed" rather than "partially covered" — partial coverage is the state
// `FORCE_QUERY_INDEX_ON_PARTIAL_INDEXES=true` reads as complete, which would
// serve an empty index as though it were the whole table.

import {
  applyQueryIndexOverrides,
  resetQueryIndexProjectionPolicyForTests,
} from '@open-mercato/shared/modules/query-index'
import { upsertIndexRow } from '../lib/indexer'
import { upsertIndexBatch } from '../lib/batch'
import { reindexEntity } from '../lib/reindexer'
import { HybridQueryEngine } from '../lib/engine'

const STOPPED = 'sales:sales_order_line'
const PROJECTED = 'sales:sales_order'

/** Any access at all fails the test — the guards must return before touching the database. */
function explodingDb(): any {
  return new Proxy({}, {
    get(_target, prop) {
      throw new Error(`Unexpected database access: ${String(prop)}`)
    },
  })
}

function explodingEm(): any {
  return { getKysely: () => explodingDb() }
}

beforeEach(() => {
  resetQueryIndexProjectionPolicyForTests()
  applyQueryIndexOverrides([{ entities: { [STOPPED]: { project: false } } }])
})

afterEach(() => {
  resetQueryIndexProjectionPolicyForTests()
})

describe('per-record write path', () => {
  it('writes no row and reports a no-op for a stopped entity type', async () => {
    const result = await upsertIndexRow(explodingEm(), { entityType: STOPPED, recordId: 'r1', tenantId: 't1' })

    expect(result).toEqual({ doc: null, existed: false, wasDeleted: false, created: false, revived: false })
  })

  it('still reaches the database for a projected entity type', async () => {
    await expect(
      upsertIndexRow(explodingEm(), { entityType: PROJECTED, recordId: 'r1', tenantId: 't1' }),
    ).rejects.toThrow(/Unexpected database access/)
  })
})

describe('bulk write path', () => {
  it('attempts nothing for a stopped entity type', async () => {
    const result = await upsertIndexBatch(explodingDb(), STOPPED, [{ id: 'r1' }], { tenantId: 't1' })

    // `attempted: 0` is what `assertIndexBatchWritesLanded` needs to read this as
    // "nothing was asked for" rather than "rows were lost".
    expect(result).toEqual({ attempted: 0, written: 0, failedRecordIds: [], searchTokenFailures: 0 })
  })

  it('still reaches the database for a projected entity type', async () => {
    await expect(
      upsertIndexBatch(explodingDb(), PROJECTED, [{ id: 'r1' }], { tenantId: 't1' }),
    ).rejects.toThrow(/Unexpected database access/)
  })
})

describe('bulk reindex', () => {
  it('processes nothing for a stopped entity type', async () => {
    const result = await reindexEntity(explodingEm(), { entityType: STOPPED, tenantId: 't1' })

    expect(result).toEqual({ processed: 0, total: 0, tenantScopes: [], scopes: [] })
  })
})

describe('coverage decision', () => {
  function buildEngine(): any {
    return new HybridQueryEngine(explodingEm(), {} as any)
  }

  it('answers "not indexed" for a stopped entity type without probing for rows', async () => {
    const engine = buildEngine()

    await expect(engine.indexAnyRows(STOPPED)).resolves.toBe(false)
  })

  it('reports no coverage gap for a stopped entity type, so it is never read as partially covered', async () => {
    const engine = buildEngine()
    const snapshot = jest.fn(async () => ({ baseCount: 4_311_577, indexedCount: 0 }))
    engine.getStoredCoverageSnapshot = snapshot

    await expect(engine.resolveCoverageGap(STOPPED, { tenantId: 't1' })).resolves.toBeNull()
    // A gap that big on a projected type is exactly what the forced-index path
    // acts on; the stopped type must not even be measured.
    expect(snapshot).not.toHaveBeenCalled()
  })

  it('still measures coverage for a projected entity type', async () => {
    const engine = buildEngine()
    engine.getStoredCoverageSnapshot = jest.fn(async () => ({ baseCount: 10, indexedCount: 3 }))

    await expect(engine.resolveCoverageGap(PROJECTED, { tenantId: 't1' })).resolves.toEqual({
      stats: { baseCount: 10, indexedCount: 3 },
      scope: 'scoped',
    })
  })
})
