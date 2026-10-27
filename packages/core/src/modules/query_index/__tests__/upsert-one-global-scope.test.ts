const mockUpsertIndexRow = jest.fn(async () => ({
  doc: { id: 'toggle-1' },
  created: true,
  revived: false,
}))
const mockReindexSearchTokensForRecord = jest.fn(async () => undefined)
const mockRecordIndexerError = jest.fn(async () => undefined)
const mockResolveQueryIndexSourceMetadata = jest.fn(() => ({
  table: 'feature_toggles',
  organizationColumn: null,
  tenantColumn: null,
}))
const mockLoadQueryIndexRowScope = jest.fn(async () => ({ kind: 'global' as const }))
const mockResolveQueryIndexRecordScope = jest.fn(() => ({ organizationId: null, tenantId: null }))

jest.mock('../lib/indexer', () => ({
  upsertIndexRow: (...args: unknown[]) => mockUpsertIndexRow(...args),
  reindexSearchTokensForRecord: (...args: unknown[]) => mockReindexSearchTokensForRecord(...args),
}))

jest.mock('../lib/subscriber-scope', () => ({
  resolveQueryIndexSourceMetadata: (...args: unknown[]) => mockResolveQueryIndexSourceMetadata(...args),
  loadQueryIndexRowScope: (...args: unknown[]) => mockLoadQueryIndexRowScope(...args),
  resolveQueryIndexRecordScope: (...args: unknown[]) => mockResolveQueryIndexRecordScope(...args),
}))

jest.mock('@open-mercato/shared/lib/indexers/error-log', () => ({
  recordIndexerError: (...args: unknown[]) => mockRecordIndexerError(...args),
}))

import handleUpsertOne from '../subscribers/upsert_one'

function flushFireAndForget() {
  return new Promise<void>((resolve) => setImmediate(resolve))
}

describe('query_index upsert_one global scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('writes an explicit global projection without a source scope query', async () => {
    const em = { getKysely: jest.fn() }
    const sourceEm = { fork: jest.fn(() => em) }
    const emitEvent = jest.fn(async () => undefined)
    const ctx = {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return sourceEm
        if (name === 'eventBus') return { emitEvent }
        throw new Error(`Unexpected token: ${name}`)
      }),
    }

    await handleUpsertOne({
      entityType: 'feature_toggles:feature_toggle',
      recordId: 'toggle-1',
      organizationId: null,
      tenantId: null,
      suppressCoverage: true,
    }, ctx)
    await flushFireAndForget()

    expect(mockResolveQueryIndexSourceMetadata).toHaveBeenCalledWith(em, 'feature_toggles:feature_toggle')
    expect(mockLoadQueryIndexRowScope).toHaveBeenCalledWith(em, expect.anything(), 'toggle-1')
    expect(em.getKysely).not.toHaveBeenCalled()
    expect(mockUpsertIndexRow).toHaveBeenCalledWith(em, expect.objectContaining({
      entityType: 'feature_toggles:feature_toggle',
      recordId: 'toggle-1',
      organizationId: null,
      tenantId: null,
    }))
    expect(mockRecordIndexerError).not.toHaveBeenCalled()
  })
})
