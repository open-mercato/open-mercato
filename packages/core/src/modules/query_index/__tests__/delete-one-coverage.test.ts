const mockMarkDeleted = jest.fn(async () => ({ wasActive: true }))
const mockApplyCoverageAdjustments = jest.fn(async () => undefined)
const mockCreateCoverageAdjustments = jest.fn(() => [])
const mockRecordIndexerError = jest.fn(async () => undefined)
const mockLoadQueryIndexRowScope = jest.fn(async () => null)
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
  resolveQueryIndexRecordScope: (...args: unknown[]) => mockResolveQueryIndexRecordScope(...(args as [any])),
}))

jest.mock('@open-mercato/shared/lib/indexers/error-log', () => ({
  recordIndexerError: (...args: unknown[]) => mockRecordIndexerError(...(args as [])),
}))

jest.mock('@open-mercato/shared/lib/query/engine', () => ({
  resolveEntityTableName: () => 'entity_indexes',
}))

import handleDeleteOne from '../subscribers/delete_one'

function createContext() {
  const emitEvent = jest.fn(async () => undefined)
  const eventBus = { emitEvent }
  // `getKysely` throws so the base-delta probe short-circuits to -1 (baseCheckSucceeded=false).
  const em = { getKysely: () => { throw new Error('no kysely in test') } }
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
})
