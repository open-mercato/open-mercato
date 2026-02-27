import { GET } from '@open-mercato/core/modules/messages/api/object-types/route'

const getMessageObjectTypesForMessageTypeMock = jest.fn()

jest.mock('@open-mercato/core/modules/messages/lib/message-objects-registry', () => ({
  getMessageObjectTypesForMessageType: (...args: unknown[]) =>
    getMessageObjectTypesForMessageTypeMock(...args),
}))

describe('messages /api/messages/object-types', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 400 when messageType query is missing', async () => {
    const response = await GET(new Request('http://localhost/api/messages/object-types'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'messageType is required' })
  })

  it('returns mapped object types for message type', async () => {
    getMessageObjectTypesForMessageTypeMock.mockReturnValue([
      {
        module: 'sales',
        entityType: 'order',
        labelKey: 'sales.order',
        icon: 'receipt',
        actions: [
          {
            id: 'approve',
            labelKey: 'approve',
            variant: 'default',
            icon: 'check',
            commandId: 'sales.orders.approve',
            href: null,
            isTerminal: true,
            confirmRequired: true,
            confirmMessage: 'Are you sure?',
          },
        ],
      },
    ])

    const response = await GET(new Request('http://localhost/api/messages/object-types?messageType=default'))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.items).toEqual([
      {
        module: 'sales',
        entityType: 'order',
        labelKey: 'sales.order',
        icon: 'receipt',
        actions: [
          {
            id: 'approve',
            labelKey: 'approve',
            variant: 'default',
            icon: 'check',
            commandId: 'sales.orders.approve',
            href: null,
            isTerminal: true,
            confirmRequired: true,
            confirmMessage: 'Are you sure?',
          },
        ],
      },
    ])
  })
})
