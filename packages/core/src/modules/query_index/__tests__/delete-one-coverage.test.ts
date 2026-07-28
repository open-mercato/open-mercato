const mockMarkDeleted = jest.fn(async () => ({ wasActive: true }))
const mockApplyCoverageAdjustments = jest.fn(async () => undefined)
const mockCreateCoverageAdjustments = jest.fn(() => [])
const mockRecordIndexerError = jest.fn(async () => undefined)
const mockLoadQueryIndexRowScope = jest.fn(async () => ({ kind: 'missing' as const }))
const mockResolveQueryIndexSourceMetadata = jest.fn(() => ({
  table: 'entity_indexes',
  organizationColumn: 'organization_id',
  tenantColumn: 'tenant_id',
}))
const mockResolveQueryIndexRecordScope = jest.fn((input: any) => ({
  organizationId: input.payloadOrganizationId ?? null,
  tenantId: input.payloadTenantId ?? null,
}))

jest.mock('../lib/indexer', () => ({
  markDeleted: (...args: unknown[]) => mockMarkDeleted(...(args as [])),
}))

jest.mock('../lib/coverage', () => ({
  applyCoverageAdjustments: (...args: unknown[]) => mockApplyCoverageAdjustments(...(args as [])),
  createCoverageAdjustments: (...args: unknown[]) => mockCreateCoverageAdjustments(...(args as [])),
}))

jest.mock('../lib/subscriber-scope', () => ({
  loadQueryIndexRowScope: (...args: unknown[]) => mockLoadQueryIndexRowScope(...(args as [])),
  resolveQueryIndexSourceMetadata: (...args: unknown[]) => mockResolveQueryIndexSourceMetadata(...(args as [])),
  resolveQueryIndexRecordScope: (...args: unknown[]) => mockResolveQueryIndexRecordScope(...(args as [any])),
}))

jest.mock('@open-mercato/shared/lib/indexers/error-log', () => ({
  recordIndexerError: (...args: unknown[]) => mockRecordIndexerError(...(args as [])),
}))

import handleDeleteOne from '../subscribers/delete_one'

function createContext(getKysely: () => unknown = () => { throw new Error('no kysely in test') }) {
  const emitEvent = jest.fn(async () => undefined)
  const eventBus = { emitEvent }
  // The default `getKysely` throws so the base-delta probe short-circuits to -1 (baseCheckSucceeded=false).
  const em = { getKysely }
  const sourceEm = { fork: jest.fn(() => em) }
  const ctx = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return sourceEm
      if (name === 'eventBus') return eventBus
      throw new Error(`Unexpected token: ${name}`)
    }),
  }
  return { ctx, emitEvent }
}

function flushFireAndForget() {
  return new Promise<void>((resolve) => setImmediate(resolve))
}

function coverageRefreshCalls(emitEvent: jest.Mock): unknown[][] {
  return emitEvent.mock.calls.filter(([event]) => event === 'query_index.coverage.refresh')
}

describe('query_index delete_one coverage refresh throttling', () => {
  const NOW = 1_700_000_000_000

  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(Date, 'now').mockReturnValue(NOW)
    mockLoadQueryIndexRowScope.mockResolvedValue({ kind: 'missing' })
    mockResolveQueryIndexSourceMetadata.mockReturnValue({
      table: 'entity_indexes',
      organizationColumn: 'organization_id',
      tenantColumn: 'tenant_id',
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('emits coverage.refresh only once for repeated deletes of the same scope within the throttle window', async () => {
    const { ctx, emitEvent } = createContext()
    const payload = { entityType: 'query_index:throttle_entity', recordId: 'r1', tenantId: 't1', organizationId: null }

    await handleDeleteOne({ ...payload }, ctx)
    await flushFireAndForget()
    await handleDeleteOne({ ...payload, recordId: 'r2' }, ctx)
    await flushFireAndForget()

    expect(coverageRefreshCalls(emitEvent)).toHaveLength(1)
  })

  it('never emits coverage.refresh when suppressCoverage is true', async () => {
    const { ctx, emitEvent } = createContext()

    await handleDeleteOne({
      entityType: 'query_index:suppressed_entity',
      recordId: 'r1',
      tenantId: 't1',
      organizationId: null,
      suppressCoverage: true,
    }, ctx)
    await flushFireAndForget()

    expect(coverageRefreshCalls(emitEvent)).toHaveLength(0)
  })

  it('always emits coverage.refresh when an explicit coverageDelayMs is provided, regardless of throttle state', async () => {
    const { ctx, emitEvent } = createContext()
    const payload = {
      entityType: 'query_index:explicit_entity',
      tenantId: 't1',
      organizationId: null,
      coverageDelayMs: 250,
    }

    await handleDeleteOne({ ...payload, recordId: 'r1' }, ctx)
    await flushFireAndForget()
    await handleDeleteOne({ ...payload, recordId: 'r2' }, ctx)
    await flushFireAndForget()

    const calls = coverageRefreshCalls(emitEvent)
    expect(calls).toHaveLength(2)
    expect(calls[0][1]).toMatchObject({ delayMs: 250 })
  })

  it('uses only the ID predicate for a global entity coverage probe', async () => {
    const executeTakeFirst = jest.fn(async () => ({ deleted_at: new Date() }))
    const baseQuery: { where: jest.Mock; executeTakeFirst: typeof executeTakeFirst } = {
      where: jest.fn(),
      executeTakeFirst,
    }
    baseQuery.where.mockReturnValue(baseQuery)
    const select = jest.fn(() => baseQuery)
    const selectFrom = jest.fn(() => ({ select }))
    const { ctx } = createContext(() => ({ selectFrom }))
    mockResolveQueryIndexSourceMetadata.mockReturnValue({
      table: 'feature_toggles',
      organizationColumn: null,
      tenantColumn: null,
    })
    mockLoadQueryIndexRowScope.mockResolvedValue({ kind: 'global' })
    mockResolveQueryIndexRecordScope.mockReturnValue({ organizationId: null, tenantId: null })

    await handleDeleteOne({
      entityType: 'feature_toggles:feature_toggle',
      recordId: 'toggle-1',
      organizationId: null,
      tenantId: null,
      suppressCoverage: true,
    }, ctx)

    expect(mockMarkDeleted).toHaveBeenCalledWith(expect.anything(), {
      entityType: 'feature_toggles:feature_toggle',
      recordId: 'toggle-1',
      organizationId: null,
      tenantId: null,
    })
    expect(selectFrom).toHaveBeenCalledWith('feature_toggles')
    expect(baseQuery.where).toHaveBeenCalledTimes(1)
    expect(baseQuery.where).toHaveBeenCalledWith('id', '=', 'toggle-1')
  })
})
