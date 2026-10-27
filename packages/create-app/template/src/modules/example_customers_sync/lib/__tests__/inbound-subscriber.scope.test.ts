const enqueue = jest.fn(async () => undefined)
const resolveExampleCustomersSyncFlags = jest.fn(async () => ({ enabled: true, bidirectional: true }))

jest.mock('../toggles', () => ({
  resolveExampleCustomersSyncFlags: (...args: unknown[]) => resolveExampleCustomersSyncFlags(...args),
}))

jest.mock('../queue', () => ({
  EXAMPLE_CUSTOMERS_SYNC_INBOUND_QUEUE: 'example-customers-sync-inbound',
  getExampleCustomersSyncQueue: () => ({ enqueue }),
}))

import { createInboundSubscriber } from '../inbound-subscriber'

describe('example customers sync inbound subscriber scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rejects payload scope that disagrees with trusted subscriber context', async () => {
    const handler = createInboundSubscriber('example.todo.deleted')

    await handler(
      {
        id: 'todo-1',
        tenantId: 'payload-tenant',
        organizationId: 'payload-organization',
      },
      {
        resolve: jest.fn(),
        tenantId: 'trusted-tenant',
        organizationId: 'trusted-organization',
      },
    )

    expect(resolveExampleCustomersSyncFlags).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('queues only the matching trusted subscriber scope', async () => {
    const handler = createInboundSubscriber('example.todo.deleted')

    await handler(
      {
        id: 'todo-1',
        tenantId: 'trusted-tenant',
        organizationId: 'trusted-organization',
      },
      {
        resolve: jest.fn(),
        tenantId: 'trusted-tenant',
        organizationId: 'trusted-organization',
      },
    )

    expect(resolveExampleCustomersSyncFlags).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'trusted-tenant', organizationId: 'trusted-organization' }),
      'trusted-tenant',
    )
    expect(enqueue).toHaveBeenCalledWith({
      eventId: 'example.todo.deleted',
      todoId: 'todo-1',
      tenantId: 'trusted-tenant',
      organizationId: 'trusted-organization',
    })
  })

  it('rejects events without trusted subscriber scope', async () => {
    const handler = createInboundSubscriber('example.todo.deleted')

    await handler(
      {
        id: 'todo-1',
        tenantId: 'payload-tenant',
        organizationId: 'payload-organization',
      },
      { resolve: jest.fn() },
    )

    expect(enqueue).not.toHaveBeenCalled()
  })
})
