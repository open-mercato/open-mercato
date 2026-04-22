import { withOnetimeApiKey } from '../apiKeyService'

describe('withOnetimeApiKey — expiry guard', () => {
  let createdInput: Record<string, unknown> | null = null
  let createdRecord: Record<string, unknown> | null = null

  const mockEm: any = {
    create: jest.fn((_Entity: unknown, data: Record<string, unknown>) => {
      createdInput = data
      createdRecord = { id: 'key-1', ...data, deletedAt: null }
      return createdRecord
    }),
    persistAndFlush: jest.fn(async () => undefined),
    removeAndFlush: jest.fn(async () => undefined),
  }

  beforeEach(() => {
    jest.clearAllMocks()
    createdInput = null
    createdRecord = null
  })

  it('caps expiresAt to max 5 minutes even when caller passes null', async () => {
    await withOnetimeApiKey(
      mockEm,
      { name: 'test', tenantId: 't1', organizationId: 'o1', roles: ['r1'], expiresAt: null } as any,
      async () => 'done',
    )

    expect(createdInput).not.toBeNull()
    const expiresAt = createdInput!.expiresAt as Date
    expect(expiresAt).toBeInstanceOf(Date)
    const ttlMs = expiresAt.getTime() - Date.now()
    expect(ttlMs).toBeLessThanOrEqual(5 * 60 * 1000 + 2000)
    expect(ttlMs).toBeGreaterThan(0)
  })

  it('soft-deletes the key after execution', async () => {
    await withOnetimeApiKey(
      mockEm,
      { name: 'test', tenantId: 't1', organizationId: 'o1', roles: ['r1'] } as any,
      async () => 'done',
    )

    expect(createdRecord!.deletedAt).toBeInstanceOf(Date)
    expect(mockEm.persistAndFlush).toHaveBeenCalled()
  })

  it('soft-deletes even when the function throws', async () => {
    await expect(
      withOnetimeApiKey(
        mockEm,
        { name: 'test', tenantId: 't1', organizationId: 'o1', roles: ['r1'] } as any,
        async () => { throw new Error('boom') },
      ),
    ).rejects.toThrow('boom')

    expect(createdRecord!.deletedAt).toBeInstanceOf(Date)
    expect(mockEm.persistAndFlush).toHaveBeenCalled()
  })

  it('does not exceed 5 minute TTL even when caller requests longer', async () => {
    const farFuture = new Date(Date.now() + 60 * 60 * 1000)

    await withOnetimeApiKey(
      mockEm,
      { name: 'test', tenantId: 't1', organizationId: 'o1', roles: ['r1'], expiresAt: farFuture } as any,
      async () => 'done',
    )

    const expiresAt = createdInput!.expiresAt as Date
    const ttlMs = expiresAt.getTime() - Date.now()
    expect(ttlMs).toBeLessThanOrEqual(5 * 60 * 1000 + 2000)
  })
})
