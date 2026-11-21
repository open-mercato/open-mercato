import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, type CompiledQuery } from 'kysely'
import { describe, expect, it, jest } from '@jest/globals'
import { GET } from '../route'
import { buildChannelInboxPredicate } from '../../../../communication_channels/lib/channel-inbox-predicate'
import type { MessagesParticipantScopeDatabase } from '../../../lib/participantScope'

const resolveMessageContextMock = jest.fn<(...args: unknown[]) => Promise<unknown>>()
const canUseChannelThreadFallbackMock = jest.fn<(...args: unknown[]) => Promise<boolean>>()

jest.mock('@open-mercato/core/modules/messages/lib/routeHelpers', () => ({
  resolveMessageContext: (...args: unknown[]) => resolveMessageContextMock(...args),
  canUseChannelThreadFallback: (...args: unknown[]) => canUseChannelThreadFallbackMock(...args),
}))

function arrange(granted: boolean, organizationId: string | null = 'org-1') {
  canUseChannelThreadFallbackMock.mockResolvedValue(granted)
  const recorded: CompiledQuery[] = []
  const db = new Kysely<MessagesParticipantScopeDatabase>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createIntrospector: (instance) => new PostgresIntrospector(instance),
    },
    log: (event) => { if (event.level === 'query') recorded.push(event.query) },
    plugins: [{
      transformQuery: (args) => args.node,
      transformResult: async (args) => ({ ...args.result, rows: [{ count: granted ? '5' : '2' }] }),
    }],
  })
  resolveMessageContextMock.mockResolvedValue({
    ctx: { container: { resolve: (name: string) => {
      if (name === 'em') return { getKysely: () => db }
      if (name === 'communicationChannelsBuildChannelInboxPredicate') return buildChannelInboxPredicate
      return null
    } } },
    scope: { userId: 'user-1', tenantId: 'tenant-1', organizationId },
  })
  return recorded
}

describe('messages unread count statement boundary', () => {
  it('counts both branches with one statement, preserving all branch filters', async () => {
    const recorded = arrange(true)
    const response = await GET(new Request('http://localhost/api/messages/unread-count'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ unreadCount: 5 })
    expect(recorded).toHaveLength(1)
    const text = recorded[0].sql.replace(/\s+/g, ' ')
    for (const clause of [
      '"m"."tenant_id" = $', '"m"."organization_id" = $', '"m"."deleted_at" is null',
      '"r"."message_id" = "m"."id"', '"r"."recipient_user_id" = $', '"r"."status" = $',
      '"r"."deleted_at" is null', '"r"."archived_at" is null', 'union all', '"m"."is_draft" = $',
      'not exists (select 1 as "one" from "message_recipients" as "rx"',
      '"mcl"."direction" = $', '"ctm"."assigned_user_id" is null',
    ]) {
      expect(text).toContain(clause)
    }
    expect(recorded[0].parameters).toEqual(expect.arrayContaining(['tenant-1', 'org-1', 'user-1', 'unread', false, 'public', 'communication_channels.external_conversation', 'inbound']))
  })

  it('keeps genuine recipient unread access without messages.view', async () => {
    const recorded = arrange(false)
    await expect((await GET(new Request('http://localhost/api/messages/unread-count'))).json()).resolves.toEqual({ unreadCount: 2 })
    expect(recorded).toHaveLength(1)
    expect(recorded[0].sql).not.toContain('message_channel_links')
    expect(recorded[0].sql).not.toContain('is_draft')
  })

  it('restricts organization-less scopes to organization-less messages', async () => {
    const recorded = arrange(true, null)
    await GET(new Request('http://localhost/api/messages/unread-count'))
    expect(recorded).toHaveLength(1)
    expect(recorded[0].sql).toContain('"m"."organization_id" is null')
  })
})
