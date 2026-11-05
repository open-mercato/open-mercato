import { GET } from '@open-mercato/core/modules/messages/api/unread-count/route'

const resolveMessageContextMock = jest.fn()

jest.mock('@open-mercato/core/modules/messages/lib/routeHelpers', () => ({
  resolveMessageContext: (...args: unknown[]) => resolveMessageContextMock(...args),
}))

describe('messages /api/messages/unread-count', () => {
  it('returns unread count scoped by tenant and organization', async () => {
    const whereCalls: any[] = []
    const chain: any = {}
    chain.innerJoin = jest.fn(() => chain)
    chain.where = jest.fn((...args: any[]) => { whereCalls.push(args); return chain })
    chain.select = jest.fn(() => chain)
    chain.executeTakeFirst = jest.fn(async () => ({ count: '7' }))

    const em = {
      getKysely: () => ({
        selectFrom: () => chain,
      }),
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
    // Ensure the scope was applied via Kysely `.where(...)` calls.
    const eqCalls = whereCalls.map((args) => args.slice(0, 3))
    expect(eqCalls).toEqual(expect.arrayContaining([
      ['r.recipient_user_id', '=', 'user-1'],
      ['r.status', '=', 'unread'],
      ['m.tenant_id', '=', 'tenant-1'],
      ['m.organization_id', '=', 'org-1'],
    ]))
  })
})
