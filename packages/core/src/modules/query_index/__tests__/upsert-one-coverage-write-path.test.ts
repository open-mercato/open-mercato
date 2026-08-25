import { __resetAlwaysConsistentCacheForTests } from '@open-mercato/shared/lib/data/consistency'

const mockRecordIndexerError = jest.fn(async () => undefined)
const mockUpsertIndexRow = jest.fn()
const mockReindexSearchTokensForRecord = jest.fn(async () => undefined)
const mockApplyCoverageAdjustments = jest.fn()
const mockCreateCoverageAdjustments = jest.fn(() => [{ entityType: 'catalog:product' }])

jest.mock('@open-mercato/shared/lib/indexers/error-log', () => ({
  recordIndexerError: (...args: unknown[]) => mockRecordIndexerError(...args),
}))

jest.mock('../lib/indexer', () => ({
  upsertIndexRow: (...args: unknown[]) => mockUpsertIndexRow(...args),
  reindexSearchTokensForRecord: (...args: unknown[]) => mockReindexSearchTokensForRecord(...args),
}))

jest.mock('../lib/coverage', () => ({
  applyCoverageAdjustments: (...args: unknown[]) => mockApplyCoverageAdjustments(...args),
  createCoverageAdjustments: (...args: unknown[]) => mockCreateCoverageAdjustments(...args),
}))

jest.mock('../lib/subscriber-scope', () => ({
  loadQueryIndexRowScope: jest.fn(async () => ({ kind: 'row', scope: { tenantId: 'tenant-1', organizationId: 'org-1' } })),
  resolveQueryIndexRecordScope: jest.fn(() => ({ tenantId: 'tenant-1', organizationId: 'org-1' })),
  resolveQueryIndexSourceMetadata: jest.fn(() => ({ table: 'catalog_products', organizationColumn: 'organization_id', tenantColumn: 'tenant_id' })),
}))

import handleUpsertOne from '../subscribers/upsert_one'

function buildCtx(em: unknown) {
  const eventBus = { emitEvent: jest.fn(async () => undefined) }
  const ctx = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return em
      if (name === 'eventBus') return eventBus
      throw new Error(`Unexpected token: ${name}`)
    }),
  }
  return { ctx, eventBus }
}

describe('query_index upsert_one coverage write path (#5604)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    __resetAlwaysConsistentCacheForTests()
    delete process.env.OM_CACHE_SAFETY_ALWAYS_CONSISTENT
  })

  afterAll(() => {
    __resetAlwaysConsistentCacheForTests()
  })

  it('resolves before the coverage-count UPSERT settles on the default (non-always-consistent) path', async () => {
    mockUpsertIndexRow.mockResolvedValue({ doc: { deleted_at: null }, existed: false, wasDeleted: false, created: true, revived: false })
    let resolveCoverage!: () => void
    mockApplyCoverageAdjustments.mockReturnValue(new Promise<void>((resolve) => {
      resolveCoverage = resolve
    }))
    const em = { fork: jest.fn(() => em), getKysely: jest.fn() }
    const { ctx } = buildCtx(em)

    await handleUpsertOne({
      entityType: 'catalog:product',
      recordId: 'record-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      crudAction: 'created',
    }, ctx)

    // The subscriber already returned even though the coverage write is still pending.
    expect(mockApplyCoverageAdjustments).toHaveBeenCalledTimes(1)
    resolveCoverage()
    await Promise.resolve()
    await Promise.resolve()
  })

  it('resolves before the coverage-count UPSERT settles on the always-consistent path', async () => {
    process.env.OM_CACHE_SAFETY_ALWAYS_CONSISTENT = 'true'
    __resetAlwaysConsistentCacheForTests()
    mockUpsertIndexRow.mockResolvedValue({ doc: { deleted_at: null }, existed: false, wasDeleted: false, created: true, revived: false })
    let resolveCoverage!: () => void
    mockApplyCoverageAdjustments.mockReturnValue(new Promise<void>((resolve) => {
      resolveCoverage = resolve
    }))
    const trx = {}
    const kysely = { transaction: () => ({ execute: (fn: (trx: unknown) => Promise<void>) => fn(trx) }) }
    const em = { fork: jest.fn(() => em), getKysely: jest.fn(() => kysely) }
    const { ctx } = buildCtx(em)

    await handleUpsertOne({
      entityType: 'catalog:product',
      recordId: 'record-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      crudAction: 'created',
    }, ctx)

    expect(mockApplyCoverageAdjustments).toHaveBeenCalledTimes(1)
    // Applied outside the index-row transaction, never with `{ trx }`.
    expect(mockApplyCoverageAdjustments.mock.calls[0][2]).toBeUndefined()
    resolveCoverage()
    await Promise.resolve()
    await Promise.resolve()
  })
})
