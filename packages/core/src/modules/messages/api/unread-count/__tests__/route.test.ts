import { GET } from '@open-mercato/core/modules/messages/api/unread-count/route'

const resolveMessageContextMock = jest.fn()

jest.mock('@open-mercato/core/modules/messages/lib/routeHelpers', () => ({
  resolveMessageContext: (...args: unknown[]) => resolveMessageContextMock(...args),
}))

describe('messages /api/messages/unread-count', () => {
  it('returns unread count scoped by tenant and organization', async () => {
    const firstMock = jest.fn(async () => ({ count: '7' }))
    const countMock = jest.fn(() => ({ first: firstMock }))
    const queryBuilder = {
      join: jest.fn(),
      where: jest.fn(),
      whereNull: jest.fn(),
      count: countMock,
    }
    queryBuilder.join.mockReturnValue(queryBuilder)
    queryBuilder.where.mockReturnValue(queryBuilder)
    queryBuilder.whereNull.mockReturnValue(queryBuilder)

    const em = {
      getConnection: () => ({ getKnex: () => () => queryBuilder }),
    }

    resolveMessageContextMock.mockResolvedValue({
      ctx: {
        container: {
          resolve: (name: string) => (name === 'em' ? em : null),
        },
      },
      scope: {
        userId: 'user-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      },
    })

    const response = await GET(new Request('http://localhost/api/messages/unread-count'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ unreadCount: 7 })
  })
})
