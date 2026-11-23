const mockMarkDeleted = jest.fn(async () => ({ wasActive: true }))
const mockApplyCoverageAdjustments = jest.fn(async () => undefined)
const mockCreateCoverageAdjustments = jest.fn(() => [])
const mockRecordIndexerError = jest.fn(async () => undefined)
const mockLoadQueryIndexRowScope = jest.fn(async () => ({ kind: 'missing' as const }))
const mockResolveQueryIndexSourceMetadata = jest.fn((): {
  table: string
  organizationColumn: string | null
  tenantColumn: string | null
  deletedAtColumn?: string
} => ({
  table: 'entity_indexes',
  organizationColumn: 'organization_id',
  tenantColumn: 'tenant_id',
}))
const mockResolveQueryIndexRecordScope = jest.fn((input: any) => ({
  organizationId: input.payloadOrganizationId ?? null,
  tenantId: input.payloadTenantId ?? null,
}))
const mockIsReadProjectionAlwaysConsistent = jest.fn(() => false)

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

jest.mock('@open-mercato/shared/lib/data/consistency', () => ({
  isReadProjectionAlwaysConsistent: () => mockIsReadProjectionAlwaysConsistent(),
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

function createAlwaysConsistentContext() {
  const emitEvent = jest.fn(async () => undefined)
  const eventBus = { emitEvent }
  const rowQuery: Record<string, jest.Mock> = {
    select: jest.fn(),
    where: jest.fn(),
    executeTakeFirst: jest.fn(async () => ({ deleted_at: new Date() })),
  }
  rowQuery.select.mockReturnValue(rowQuery)
  rowQuery.where.mockReturnValue(rowQuery)
  const trx = { selectFrom: jest.fn(() => rowQuery) }
  const db = {
    transaction: jest.fn(() => ({
      execute: jest.fn(async (run: (executor: typeof trx) => Promise<void>) => run(trx)),
    })),
  }
  const em = { getKysely: () => db }
  const sourceEm = { fork: jest.fn(() => em) }
  const ctx = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return sourceEm
      if (name === 'eventBus') return eventBus
      throw new Error(`Unexpected token: ${name}`)
    }),
  }
  return { ctx, emitEvent, rowQuery, trx }
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
    mockIsReadProjectionAlwaysConsistent.mockReturnValue(false)
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

  it('never emits coverage.refresh when suppressCoverage is true in always-consistent mode', async () => {
    mockIsReadProjectionAlwaysConsistent.mockReturnValue(true)
    const { ctx, emitEvent } = createAlwaysConsistentContext()

    await handleDeleteOne({
      entityType: 'query_index:suppressed_consistent_entity',
      recordId: 'r1',
      tenantId: 't1',
      organizationId: null,
      suppressCoverage: true,
    }, ctx)

    expect(coverageRefreshCalls(emitEvent)).toHaveLength(0)
    expect(emitEvent).toHaveBeenCalledWith(
      'search.delete_record',
      expect.objectContaining({ entityId: 'query_index:suppressed_consistent_entity', recordId: 'r1' }),
      { rethrowHandlerErrors: true, tenantId: null, organizationId: null },
    )
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

  it('uses only the ID predicate for a global entity coverage probe in always-consistent mode', async () => {
    mockIsReadProjectionAlwaysConsistent.mockReturnValue(true)
    mockResolveQueryIndexSourceMetadata.mockReturnValue({
      table: 'feature_toggles',
      organizationColumn: null,
      tenantColumn: null,
    })
    mockLoadQueryIndexRowScope.mockResolvedValue({ kind: 'global' })
    mockResolveQueryIndexRecordScope.mockReturnValue({ organizationId: null, tenantId: null })
    const { ctx, rowQuery, trx } = createAlwaysConsistentContext()

    await handleDeleteOne({
      entityType: 'feature_toggles:feature_toggle',
      recordId: 'toggle-consistent-1',
      organizationId: null,
      tenantId: null,
      suppressCoverage: true,
    }, ctx)

    expect(mockMarkDeleted).toHaveBeenCalledWith(expect.anything(), {
      entityType: 'feature_toggles:feature_toggle',
      recordId: 'toggle-consistent-1',
      organizationId: null,
      tenantId: null,
      trx,
    })
    expect(trx.selectFrom).toHaveBeenCalledWith('feature_toggles')
    expect(rowQuery.where).toHaveBeenCalledTimes(1)
    expect(rowQuery.where).toHaveBeenCalledWith('id', '=', 'toggle-consistent-1')
  })

  it.each([false, true].flatMap((alwaysConsistent) => [
    { alwaysConsistent, state: 'live hard-delete row', row: { id: 'section-1' }, baseDelta: 0 },
    { alwaysConsistent, state: 'live soft-delete row', row: { archived_at: null }, baseDelta: 0 },
    { alwaysConsistent, state: 'soft-deleted row', row: { archived_at: new Date('2026-01-01') }, baseDelta: -1 },
    { alwaysConsistent, state: 'missing row', row: undefined, baseDelta: -1 },
  ]))('handles $state when synchronous consistency is $alwaysConsistent', async ({ alwaysConsistent, row, baseDelta }) => {
    mockIsReadProjectionAlwaysConsistent.mockReturnValue(alwaysConsistent)
    mockResolveQueryIndexRecordScope.mockReturnValue({ organizationId: 'org-1', tenantId: 'tenant-1' })
    const { ctx: consistentContext, rowQuery } = createAlwaysConsistentContext()
    const deletedAtColumn = row && 'archived_at' in row ? 'archived_at' : undefined
    mockResolveQueryIndexSourceMetadata.mockReturnValue({
      table: 'entity_indexes',
      organizationColumn: 'organization_id',
      tenantColumn: 'tenant_id',
      deletedAtColumn,
    })
    rowQuery.executeTakeFirst.mockResolvedValue(row)
    const { ctx: deferredContext } = createContext(() => ({ selectFrom: () => rowQuery }))

    await handleDeleteOne({
      entityType: 'attachments:attachment_document_section',
      recordId: 'section-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      suppressCoverage: true,
    }, alwaysConsistent ? consistentContext : deferredContext)
    await flushFireAndForget()

    expect(mockCreateCoverageAdjustments).toHaveBeenCalledWith({
      entityType: 'attachments:attachment_document_section',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      baseDelta,
      indexDelta: -1,
    })
    expect(mockRecordIndexerError).not.toHaveBeenCalled()
    expect(rowQuery.select).toHaveBeenCalledTimes(1)
    expect(rowQuery.select).toHaveBeenCalledWith(deletedAtColumn ?? 'id')
    expect(rowQuery.where).toHaveBeenCalledTimes(3)
    expect(rowQuery.where).toHaveBeenCalledWith('organization_id', '=', 'org-1')
  })
})
