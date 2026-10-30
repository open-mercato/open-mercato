import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
} from 'kysely'
import { GET } from '@open-mercato/core/modules/messages/api/unread-count/route'
import { buildChannelInboxPredicate } from '@open-mercato/core/modules/communication_channels/lib/channel-inbox-predicate'

const resolveMessageContextMock = jest.fn()

const canUseChannelThreadFallbackMock = jest.fn(async (..._args: unknown[]) => false)

jest.mock('@open-mercato/core/modules/messages/lib/routeHelpers', () => ({
  resolveMessageContext: (...args: unknown[]) => resolveMessageContextMock(...args),
  // Channel-inbox widening (#6106) off unless a test opts in.
  canUseChannelThreadFallback: (...args: unknown[]) => canUseChannelThreadFallbackMock(...args),
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

  describe('channel-inbox messages without a recipient row (#6106)', () => {
    function arrange(options: { granted: boolean }) {
      canUseChannelThreadFallbackMock.mockResolvedValue(options.granted)
      const recorded: CompiledQuery[] = []
      const db = new Kysely<any>({
        dialect: {
          createAdapter: () => new PostgresAdapter(),
          createDriver: () => new DummyDriver(),
          createQueryCompiler: () => new PostgresQueryCompiler(),
          createIntrospector: (instance: Kysely<any>) => new PostgresIntrospector(instance),
        },
      })
      ;(db.getExecutor() as any).executeQuery = async (query: CompiledQuery) => {
        recorded.push(query)
        const isRecipientCount = query.sql.includes('"message_recipients" as "r"') && !query.sql.includes('"rx"')
        return { rows: [{ count: isRecipientCount ? '2' : '3' }] }
      }
      resolveMessageContextMock.mockResolvedValue({
        ctx: {
          container: {
            resolve: (name: string) => {
              if (name === 'em') return { getKysely: () => db }
              if (name === 'communicationChannelsBuildChannelInboxPredicate') return buildChannelInboxPredicate
              return null
            },
          },
        },
        scope: { userId: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' },
      })
      return recorded
    }

    it('counts them on top of the unread recipient rows', async () => {
      const recorded = arrange({ granted: true })

      const response = await GET(new Request('http://localhost/api/messages/unread-count'))

      await expect(response.json()).resolves.toEqual({ unreadCount: 5 })
      expect(recorded).toHaveLength(2)
      const text = recorded[1]!.sql.replace(/\s+/g, ' ')
      expect(text).toContain('"m"."is_draft" = $')
      expect(text).toMatch(/not exists \(select 1 as "one" from "message_recipients" as "rx"/)
      expect(text).toContain('"mcl"."direction" = $')
      expect(text).toContain('"ctm"."assigned_user_id" is null')
      expect(recorded[1]!.parameters).toEqual(
        expect.arrayContaining(['tenant-1', 'org-1', 'public', 'communication_channels.external_conversation', 'inbound', 'user-1']),
      )
    })

    it('counts only recipient rows without messages.view', async () => {
      const recorded = arrange({ granted: false })

      const response = await GET(new Request('http://localhost/api/messages/unread-count'))

      await expect(response.json()).resolves.toEqual({ unreadCount: 2 })
      expect(recorded).toHaveLength(1)
    })
  })
})
