import { __resetAlwaysConsistentCacheForTests } from '@open-mercato/shared/lib/data/consistency'

const mockRecordIndexerError = jest.fn(async () => undefined)
const mockMarkDeleted = jest.fn(async () => ({ wasActive: true }))
const mockApplyCoverageAdjustments = jest.fn()
const mockCreateCoverageAdjustments = jest.fn(() => [{ entityType: 'catalog:product' }])

jest.mock('@open-mercato/shared/lib/indexers/error-log', () => ({
  recordIndexerError: (...args: unknown[]) => mockRecordIndexerError(...args),
}))

jest.mock('../lib/indexer', () => ({
  markDeleted: (...args: unknown[]) => mockMarkDeleted(...args),
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

import handleDeleteOne from '../subscribers/delete_one'

function buildChainableQuery(row: unknown) {
  const query: any = {
    select: () => query,
    where: () => query,
    executeTakeFirst: async () => row,
  }
  return query
}

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

describe('query_index delete_one coverage write path (#5604)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    __resetAlwaysConsistentCacheForTests()
    delete process.env.OM_CACHE_SAFETY_ALWAYS_CONSISTENT
  })

  afterAll(() => {
    __resetAlwaysConsistentCacheForTests()
  })

  it('resolves before the coverage-count UPSERT settles on the default (non-always-consistent) path', async () => {
    let resolveCoverage!: () => void
    mockApplyCoverageAdjustments.mockReturnValue(new Promise<void>((resolve) => {
      resolveCoverage = resolve
    }))
    const row = { deleted_at: new Date() }
    const kysely = { selectFrom: () => buildChainableQuery(row) }
    const em = { fork: jest.fn(() => em), getKysely: jest.fn(() => kysely) }
    const { ctx } = buildCtx(em)

    await handleDeleteOne({
      entityType: 'catalog:product',
      recordId: 'record-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    }, ctx)

    expect(mockApplyCoverageAdjustments).toHaveBeenCalledTimes(1)
    resolveCoverage()
    await Promise.resolve()
    await Promise.resolve()
  })

  it('resolves before the coverage-count UPSERT settles on the always-consistent path', async () => {
    process.env.OM_CACHE_SAFETY_ALWAYS_CONSISTENT = 'true'
    __resetAlwaysConsistentCacheForTests()
    let resolveCoverage!: () => void
    mockApplyCoverageAdjustments.mockReturnValue(new Promise<void>((resolve) => {
      resolveCoverage = resolve
    }))
    const row = { deleted_at: new Date() }
    const trx = { selectFrom: () => buildChainableQuery(row) }
    const kysely = { transaction: () => ({ execute: (fn: (trx: unknown) => Promise<void>) => fn(trx) }) }
    const em = { fork: jest.fn(() => em), getKysely: jest.fn(() => kysely) }
    const { ctx } = buildCtx(em)

    await handleDeleteOne({
      entityType: 'catalog:product',
      recordId: 'record-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    }, ctx)

    expect(mockApplyCoverageAdjustments).toHaveBeenCalledTimes(1)
    expect(mockApplyCoverageAdjustments.mock.calls[0][2]).toBeUndefined()
    resolveCoverage()
    await Promise.resolve()
    await Promise.resolve()
  })
})
