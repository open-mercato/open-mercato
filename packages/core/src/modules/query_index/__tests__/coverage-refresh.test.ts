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

      const completion = handleCoverageRefresh({
        entityType: 'catalog:catalog_product',
        tenantId: 'tenant-1',
        organizationId: null,
        delayMs: 25,
      }, ctx)

      expect(sourceEm.fork).not.toHaveBeenCalled()
      await jest.advanceTimersByTimeAsync(25)
      await completion

      expect(sourceEm.fork).toHaveBeenCalledTimes(1)
      expect(mockRefreshCoverageSnapshot).toHaveBeenCalledWith(forkedEm, expect.objectContaining({
        entityType: 'catalog:catalog_product',
      }))
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('coverage refresh accepted lifetime', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
  })

  afterEach(() => {
    expect(jest.getTimerCount()).toBe(0)
    jest.useRealTimers()
  })

  it('keeps every coalesced caller pending until the latest refresh finishes', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    mockRefreshCoverageSnapshot.mockImplementationOnce(async () => { await gate })
    const sourceEm = { fork: jest.fn(() => ({})) }
    const ctx = { resolve: jest.fn(() => sourceEm) }
    const payload = { entityType: 'customers:customer_person', tenantId: 'tenant-1', delayMs: 25 }
    const settled: string[] = []
    const first = handleCoverageRefresh(payload, ctx).then(() => { settled.push('first') })
    await jest.advanceTimersByTimeAsync(10)
    const second = handleCoverageRefresh(payload, ctx).then(() => { settled.push('second') })
    await jest.advanceTimersByTimeAsync(24)
    expect(mockRefreshCoverageSnapshot).not.toHaveBeenCalled()
    expect(settled).toEqual([])
    await jest.advanceTimersByTimeAsync(1)
    expect(mockRefreshCoverageSnapshot).toHaveBeenCalledTimes(1)
    expect(settled).toEqual([])
    release()
    await Promise.all([first, second])
    expect(settled).toEqual(['first', 'second'])
    const next = handleCoverageRefresh(payload, ctx)
    await jest.advanceTimersByTimeAsync(25)
    await next
    expect(mockRefreshCoverageSnapshot).toHaveBeenCalledTimes(2)
  })
})
