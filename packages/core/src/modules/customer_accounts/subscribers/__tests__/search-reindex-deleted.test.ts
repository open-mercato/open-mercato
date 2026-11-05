import handle from '../search-reindex-deleted'

const emitEventMock = jest.fn(async () => undefined)

describe('customer_accounts search reindex deleted subscriber', () => {
  const ctx = { resolve: jest.fn(() => ({ emitEvent: emitEventMock })) }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('emits query_index.delete_one event for valid payload', async () => {
    await handle({
      id: 'user-123',
      email: 'test@example.com',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      deletedBy: 'admin-1',
    }, ctx)

    expect(ctx.resolve).toHaveBeenCalledWith('eventBus')
    expect(emitEventMock).toHaveBeenCalledWith(
      'query_index.delete_one',
      {
        entityType: 'customer_accounts:customer_user',
        recordId: 'user-123',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
      },
      {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      },
    )
  })

  it('skips event when userId is missing', async () => {
    await handle({
      email: 'test@example.com',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    }, ctx)

    expect(emitEventMock).not.toHaveBeenCalled()
  })

  it('skips event when tenantId is missing', async () => {
    await handle({
      id: 'user-123',
      email: 'test@example.com',
      organizationId: 'org-1',
    }, ctx)

    expect(emitEventMock).not.toHaveBeenCalled()
  })

  it('handles missing organizationId gracefully', async () => {
    await handle({
      id: 'user-123',
      email: 'test@example.com',
      tenantId: 'tenant-1',
      organizationId: null,
    }, ctx)

    expect(emitEventMock).toHaveBeenCalledWith(
      'query_index.delete_one',
      expect.objectContaining({
        organizationId: null,
      }),
      expect.objectContaining({
        organizationId: null,
      }),
    )
  })

  it('handles eventBus resolution failure gracefully', async () => {
    const failureCtx = { resolve: jest.fn(() => { throw new Error('Resolution failed') }) }

    await expect(handle({
      id: 'user-123',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    }, failureCtx)).resolves.toBeUndefined()

    expect(emitEventMock).not.toHaveBeenCalled()
  })
})