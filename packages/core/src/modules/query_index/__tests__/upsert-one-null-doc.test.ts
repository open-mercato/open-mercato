import type { UpsertIndexResult } from '../lib/indexer'

const mockUpsertIndexRow = jest.fn<Promise<UpsertIndexResult>, unknown[]>()
const mockReindexSearchTokensForRecord = jest.fn(async () => undefined)
const mockRecordIndexerError = jest.fn(async () => undefined)
const mockApplyCoverageAdjustments = jest.fn(async () => undefined)
const mockCreateCoverageAdjustments = jest.fn((input: { baseDelta: number; indexDelta: number }) => [input])
let mockAlwaysConsistent = false

jest.mock('../lib/indexer', () => ({
  upsertIndexRow: (...args: unknown[]) => mockUpsertIndexRow(...args),
  reindexSearchTokensForRecord: (...args: unknown[]) => mockReindexSearchTokensForRecord(...args),
}))

jest.mock('../lib/coverage', () => ({
  applyCoverageAdjustments: (...args: unknown[]) => mockApplyCoverageAdjustments(...args),
  createCoverageAdjustments: (input: { baseDelta: number; indexDelta: number }) => mockCreateCoverageAdjustments(input),
}))

jest.mock('../lib/subscriber-scope', () => ({
  resolveQueryIndexSourceMetadata: () => ({ table: 'customer_people', organizationColumn: 'organization_id', tenantColumn: 'tenant_id' }),
  loadQueryIndexRowScope: async () => ({ kind: 'row', scope: { organizationId: 'org-1', tenantId: 'tenant-1' } }),
  resolveQueryIndexRecordScope: () => ({ organizationId: 'org-1', tenantId: 'tenant-1' }),
}))

jest.mock('@open-mercato/shared/lib/indexers/error-log', () => ({
  recordIndexerError: (...args: unknown[]) => mockRecordIndexerError(...args),
}))

jest.mock('@open-mercato/shared/lib/data/consistency', () => ({
  isReadProjectionAlwaysConsistent: () => mockAlwaysConsistent,
}))

import handleUpsertOne from '../subscribers/upsert_one'

const flushFireAndForget = () => new Promise<void>((resolve) => setImmediate(resolve))

const removedProjection: UpsertIndexResult = { doc: null, existed: true, wasDeleted: false, created: false, revived: false }
const liveProjection: UpsertIndexResult = { doc: { id: 'profile-1' }, existed: true, wasDeleted: false, created: false, revived: false }

function makeContext() {
  const emitEvent = jest.fn(async () => undefined)
  const trx = {}
  const em = { getKysely: () => ({ transaction: () => ({ execute: async (fn: (t: unknown) => Promise<unknown>) => fn(trx) }) }) }
  const ctx = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return { fork: () => em }
      if (name === 'eventBus') return { emitEvent }
      throw new Error(`[internal] unexpected token: ${name}`)
    }),
  }
  return { ctx, emitEvent }
}

const emittedEvents = (emitEvent: jest.Mock) => emitEvent.mock.calls.map(([event]) => event as string)

describe.each([false, true])('query_index upsert_one with a removed projection (alwaysConsistent=%s) (#8638)', (alwaysConsistent) => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAlwaysConsistent = alwaysConsistent
  })

  it('emits a search delete instead of index/vectorize and decrements indexed coverage', async () => {
    mockUpsertIndexRow.mockResolvedValue(removedProjection)
    const { ctx, emitEvent } = makeContext()

    await handleUpsertOne({ entityType: 'customers:customer_person_profile', recordId: 'profile-1', organizationId: 'org-1', tenantId: 'tenant-1' }, ctx)
    await flushFireAndForget()

    const events = emittedEvents(emitEvent)
    expect(events).toContain('search.delete_record')
    expect(events).not.toContain('search.index_record')
    expect(events).not.toContain('query_index.vectorize_one')
    expect(mockCreateCoverageAdjustments).toHaveBeenCalledWith(expect.objectContaining({ indexDelta: -1, baseDelta: 0 }))
    expect(mockRecordIndexerError).not.toHaveBeenCalled()
  })

  it('keeps indexing and vectorizing a live projection', async () => {
    mockUpsertIndexRow.mockResolvedValue(liveProjection)
    const { ctx, emitEvent } = makeContext()

    await handleUpsertOne({ entityType: 'customers:customer_person_profile', recordId: 'profile-1', organizationId: 'org-1', tenantId: 'tenant-1' }, ctx)
    await flushFireAndForget()

    const events = emittedEvents(emitEvent)
    expect(events).toEqual(expect.arrayContaining(['query_index.vectorize_one', 'search.index_record']))
    expect(events).not.toContain('search.delete_record')
    expect(mockCreateCoverageAdjustments).toHaveBeenCalledWith(expect.objectContaining({ indexDelta: 0 }))
  })

  it('does not decrement coverage when the projection was already soft-deleted', async () => {
    mockUpsertIndexRow.mockResolvedValue({ ...removedProjection, wasDeleted: true })
    const { ctx } = makeContext()

    await handleUpsertOne({ entityType: 'customers:customer_person_profile', recordId: 'profile-1', organizationId: 'org-1', tenantId: 'tenant-1' }, ctx)
    await flushFireAndForget()

    expect(mockCreateCoverageAdjustments).toHaveBeenCalledWith(expect.objectContaining({ indexDelta: 0 }))
  })
})
