import { GET } from '@open-mercato/core/modules/messages/api/object-options/route'

const resolveMessageContextMock = jest.fn()
const getMessageTypeMock = jest.fn()
const getMessageObjectTypeMock = jest.fn()
const isAllowedMock = jest.fn()
const queryMock = jest.fn()

jest.mock('@open-mercato/core/modules/messages/lib/routeHelpers', () => ({
  resolveMessageContext: (...args: unknown[]) => resolveMessageContextMock(...args),
}))

jest.mock('@open-mercato/core/modules/messages/lib/message-types-registry', () => ({
  getMessageType: (...args: unknown[]) => getMessageTypeMock(...args),
}))

jest.mock('@open-mercato/core/modules/messages/lib/message-objects-registry', () => ({
  getMessageObjectType: (...args: unknown[]) => getMessageObjectTypeMock(...args),
  isMessageObjectTypeAllowedForMessageType: (...args: unknown[]) => isAllowedMock(...args),
}))

describe('messages /api/messages/object-options', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    resolveMessageContextMock.mockResolvedValue({
      ctx: {
        container: {
          resolve: (name: string) => {
            if (name === 'queryEngine') {
              return { query: queryMock }
            }
            return null
          },
        },
      },
      scope: {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        userId: 'user-1',
      },
    })

    getMessageTypeMock.mockReturnValue({ type: 'default' })
    getMessageObjectTypeMock.mockReturnValue({
      module: 'customers',
      entityType: 'person',
      labelKey: 'customers.person',
      optionLabelField: 'name',
      optionSubtitleField: '',
    })
    isAllowedMock.mockReturnValue(true)
  })

  it('returns 400 for invalid query params', async () => {
    const response = await GET(new Request('http://localhost/api/messages/object-options'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid object options query' })
  })

  it('returns 400 for unknown message type', async () => {
    getMessageTypeMock.mockReturnValue(undefined)

    const response = await GET(
      new Request('http://localhost/api/messages/object-options?messageType=missing&entityModule=customers&entityType=person'),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Unknown message type' })
  })

  it('returns 404 when object type is missing', async () => {
    getMessageObjectTypeMock.mockReturnValue(undefined)

    const response = await GET(
      new Request('http://localhost/api/messages/object-options?messageType=default&entityModule=customers&entityType=person'),
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Message object type not found' })
  })

  it('returns 403 when object type is disallowed for message type', async () => {
    isAllowedMock.mockReturnValue(false)

    const response = await GET(
      new Request('http://localhost/api/messages/object-options?messageType=default&entityModule=customers&entityType=person'),
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Object type is not allowed for this message type' })
  })

  it('maps query engine rows into deterministic options with fallback labels', async () => {
    queryMock.mockResolvedValue({
      items: [
        { id: 'p1', name: 'Alice', email: 'alice@example.com' },
        { id: 'p2', email: 'bob@example.com' },
        { id: null, name: 'Skip this row' },
      ],
      total: 2,
    })

    const response = await GET(
      new Request('http://localhost/api/messages/object-options?messageType=default&entityModule=customers&entityType=person&search=ali&page=2&pageSize=1'),
    )

    expect(response.status).toBe(200)
    const body = await response.json()

    expect(queryMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        page: { page: 2, pageSize: 1 },
      }),
    )

    expect(body).toEqual({
      items: [
        { id: 'p1', label: 'Alice', subtitle: 'alice@example.com' },
        { id: 'p2', label: 'bob@example.com', subtitle: 'bob@example.com' },
      ],
      page: 2,
      pageSize: 1,
      total: 2,
      totalPages: 2,
    })
  })
})
