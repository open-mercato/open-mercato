import { SalesDocumentNumberGenerator } from '../salesDocumentNumberGenerator'

function createEm(execute: jest.Mock) {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    getConnection: () => ({ execute }),
  } as any
}

const scope = { organizationId: 'org_1', tenantId: 'tenant_1' }

describe('SalesDocumentNumberGenerator sequence claiming (#5604)', () => {
  it('coalesces waiters that arrive while a claim is already in flight into one UPDATE', async () => {
    let resolveFirst!: (value: unknown) => void
    const firstClaim = new Promise((resolve) => {
      resolveFirst = resolve
    })
    const execute = jest.fn()
      .mockReturnValueOnce(firstClaim)
      .mockResolvedValueOnce([{ current_value: '3' }])
    const generator = new SalesDocumentNumberGenerator(createEm(execute))

    const firstCall = generator.generate({ kind: 'order', ...scope })
    // Let the first call run through `getSettings()` and dispatch its own (solo) claim.
    await Promise.resolve()
    await Promise.resolve()
    expect(execute).toHaveBeenCalledTimes(1)

    // These arrive while the first claim's DB round trip is still in flight, so they queue
    // behind it instead of each starting their own round trip.
    const secondCall = generator.generate({ kind: 'order', ...scope })
    const thirdCall = generator.generate({ kind: 'order', ...scope })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(execute).toHaveBeenCalledTimes(1)

    resolveFirst([{ current_value: '1' }])
    const first = await firstCall
    expect(first.sequence).toBe(1)

    const [second, third] = await Promise.all([secondCall, thirdCall])
    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute.mock.calls[1][1]).toEqual(['org_1', 'tenant_1', 'order', 2, 2])
    expect(second.sequence).toBe(2)
    expect(third.sequence).toBe(3)
    expect(new Set([first.number, second.number, third.number]).size).toBe(3)
  })

  it('claims exactly one value per call under low concurrency, matching prior behavior', async () => {
    const execute = jest.fn()
      .mockResolvedValueOnce([{ current_value: '1' }])
      .mockResolvedValueOnce([{ current_value: '2' }])
    const generator = new SalesDocumentNumberGenerator(createEm(execute))

    const first = await generator.generate({ kind: 'order', ...scope })
    const second = await generator.generate({ kind: 'order', ...scope })

    expect(first.sequence).toBe(1)
    expect(second.sequence).toBe(2)
    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute.mock.calls[0][1]).toEqual(['org_1', 'tenant_1', 'order', 1, 1])
    expect(execute.mock.calls[1][1]).toEqual(['org_1', 'tenant_1', 'order', 1, 1])
  })

  it('keeps separate scopes and document kinds on independent claim queues', async () => {
    const execute = jest.fn()
      .mockResolvedValueOnce([{ current_value: '1' }])
      .mockResolvedValueOnce([{ current_value: '1' }])
    const generator = new SalesDocumentNumberGenerator(createEm(execute))

    const order = await generator.generate({ kind: 'order', ...scope })
    const quote = await generator.generate({ kind: 'quote', ...scope })

    expect(order.sequence).toBe(1)
    expect(quote.sequence).toBe(1)
    expect(execute.mock.calls[0][1]).toEqual(['org_1', 'tenant_1', 'order', 1, 1])
    expect(execute.mock.calls[1][1]).toEqual(['org_1', 'tenant_1', 'quote', 1, 1])
  })

  it('rejects every queued waiter when the claim fails, without wedging later claims', async () => {
    const execute = jest.fn()
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce([{ current_value: '1' }])
    const generator = new SalesDocumentNumberGenerator(createEm(execute))

    await expect(generator.generate({ kind: 'order', ...scope })).rejects.toThrow('connection lost')

    const recovered = await generator.generate({ kind: 'order', ...scope })
    expect(recovered.sequence).toBe(1)
  })
})
