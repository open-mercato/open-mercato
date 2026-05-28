const mockRefreshCoverageSnapshot = jest.fn(async () => undefined)
const mockRecordIndexerError = jest.fn(async () => undefined)

jest.mock('../lib/coverage', () => ({
  refreshCoverageSnapshot: (...args: unknown[]) => mockRefreshCoverageSnapshot(...args),
}))

jest.mock('@open-mercato/shared/lib/indexers/error-log', () => ({
  recordIndexerError: (...args: unknown[]) => mockRecordIndexerError(...args),
}))

import handleCoverageRefresh from '../subscribers/coverage_refresh'

describe('query_index coverage refresh subscriber', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('uses a fresh EntityManager fork for immediate snapshot refreshes', async () => {
    const forkedEm = { id: 'forked-em' }
    const sourceEm = {
      id: 'source-em',
      fork: jest.fn(() => forkedEm),
    }
    const ctx = {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return sourceEm
        throw new Error(`Unexpected token: ${name}`)
      }),
    }

    await handleCoverageRefresh({
      entityType: 'catalog:catalog_product',
      tenantId: 'tenant-1',
      organizationId: null,
      delayMs: 0,
    }, ctx)

    expect(sourceEm.fork).toHaveBeenCalledWith({
      clear: true,
      freshEventManager: true,
      useContext: false,
    })
    expect(mockRefreshCoverageSnapshot).toHaveBeenCalledWith(forkedEm, {
      entityType: 'catalog:catalog_product',
      tenantId: 'tenant-1',
      organizationId: null,
      withDeleted: false,
    })
  })

  it('creates the EntityManager fork when a delayed refresh actually runs', async () => {
    jest.useFakeTimers()
    try {
      const forkedEm = { id: 'forked-delayed-em' }
      const sourceEm = {
        fork: jest.fn(() => forkedEm),
      }
      const ctx = {
        resolve: jest.fn((name: string) => {
          if (name === 'em') return sourceEm
          throw new Error(`Unexpected token: ${name}`)
        }),
      }

      await handleCoverageRefresh({
        entityType: 'catalog:catalog_product',
        tenantId: 'tenant-1',
        organizationId: null,
        delayMs: 25,
      }, ctx)

      expect(sourceEm.fork).not.toHaveBeenCalled()
      await jest.advanceTimersByTimeAsync(25)

      expect(sourceEm.fork).toHaveBeenCalledTimes(1)
      expect(mockRefreshCoverageSnapshot).toHaveBeenCalledWith(forkedEm, expect.objectContaining({
        entityType: 'catalog:catalog_product',
      }))
    } finally {
      jest.useRealTimers()
    }
  })
})
