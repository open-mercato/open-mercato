const mockRecordIndexerError = jest.fn(async () => undefined)
const mockRecordIndexerLog = jest.fn(async () => undefined)
const mockReindexEntity = jest.fn(async () => ({
  processed: 0,
  total: 0,
  tenantScopes: [],
  scopes: [],
}))

jest.mock('@open-mercato/shared/lib/indexers/error-log', () => ({
  recordIndexerError: (...args: unknown[]) => mockRecordIndexerError(...args),
}))

jest.mock('@open-mercato/shared/lib/indexers/status-log', () => ({
  recordIndexerLog: (...args: unknown[]) => mockRecordIndexerLog(...args),
}))

jest.mock('../lib/reindexer', () => ({
  reindexEntity: (...args: unknown[]) => mockReindexEntity(...args),
}))

import handleReindex from '../subscribers/reindex'

describe('query_index reindex subscriber', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('uses a fresh EntityManager fork for reindex work', async () => {
    const forkedEm = { id: 'forked-em' }
    const sourceEm = {
      id: 'source-em',
      fork: jest.fn(() => forkedEm),
    }
    const eventBus = { emitEvent: jest.fn(async () => undefined) }
    const ctx = {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return sourceEm
        if (name === 'eventBus') return eventBus
        throw new Error(`Unexpected token: ${name}`)
      }),
    }

    await handleReindex({
      entityType: 'checkout:checkout_transaction',
      tenantId: 'tenant-1',
      organizationId: null,
      force: true,
    }, ctx)

    expect(sourceEm.fork).toHaveBeenCalledWith({
      clear: true,
      freshEventManager: true,
      useContext: false,
    })
    expect(mockReindexEntity).toHaveBeenCalledWith(forkedEm, expect.objectContaining({
      entityType: 'checkout:checkout_transaction',
      tenantId: 'tenant-1',
      organizationId: null,
    }))
    expect(mockRecordIndexerLog).toHaveBeenCalledWith(
      { em: forkedEm },
      expect.objectContaining({
        source: 'query_index',
        handler: 'event:query_index.reindex',
        message: 'Reindex started for checkout:checkout_transaction',
      }),
    )
  })
})
