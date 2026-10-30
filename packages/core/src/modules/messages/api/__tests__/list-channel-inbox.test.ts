/** @jest-environment node */

// #6106: the inbox / all folders widen their recipient-or-sender rule with the
// channel-inbox predicate (inbound, unassigned conversation, accessible channel).
// These tests compile the real list query — with the real channels-hub predicate
// resolved through DI — and pin the predicate, the folders it applies to, the
// `messages.view` gate, the status reported for rows without a recipient row and
// the cache bypass.

import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
} from 'kysely'
import { Message } from '../../data/entities'
import { buildChannelInboxPredicate } from '../../../communication_channels/lib/channel-inbox-predicate'

const tenantId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'
const operatorId = '33333333-3333-4333-8333-333333333333'
const systemSenderId = '44444444-4444-4444-8444-444444444444'

const resolveMessageContextMock = jest.fn()
const canUseChannelThreadFallbackMock = jest.fn()

jest.mock('@open-mercato/core/modules/messages/lib/routeHelpers', () => ({
  resolveMessageContext: (...args: unknown[]) => resolveMessageContextMock(...args),
  canUseMessageEmailFeature: jest.fn(async () => true),
  canUseChannelThreadFallback: (...args: unknown[]) => canUseChannelThreadFallbackMock(...args),
}))

jest.mock('@open-mercato/core/modules/messages/lib/searchLookup', () => ({
  findMessageIdsBySearchTokens: jest.fn(async () => []),
}))

jest.mock('@open-mercato/core/modules/messages/lib/message-types-registry', () => ({
  getMessageType: jest.fn(() => null),
}))

const findWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

const cacheGetMock = jest.fn()
const cacheSetMock = jest.fn()

jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/crud/cache'),
  buildCollectionTags: jest.fn(() => []),
  debugCrudCache: jest.fn(),
  isCrudCacheEnabled: jest.fn(() => true),
  resolveCrudCache: jest.fn(() => ({ get: cacheGetMock, set: cacheSetMock })),
}))

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: async (_tenantId: string, fn: () => unknown) => fn(),
}))

const recordedQueries: CompiledQuery[] = []
let scopeRows: Array<Record<string, unknown>> = []

function isScopeQuery(q: CompiledQuery): boolean {
  const s = q.sql.toLowerCase()
  return s.includes('"messages"') && s.includes('order by')
}

function createRecordingKysely(): Kysely<any> {
  const db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createIntrospector: (instance: Kysely<any>) => new PostgresIntrospector(instance),
    },
  })
  ;(db.getExecutor() as any).executeQuery = async (q: CompiledQuery) => {
    recordedQueries.push(q)
    if (q.sql.toLowerCase().includes('count(*)')) return { rows: [{ count: String(scopeRows.length) }] }
    if (isScopeQuery(q)) return { rows: scopeRows }
    return { rows: [] }
  }
  return db
}

function makeMessage(id: string, senderUserId: string): Partial<Message> {
  return {
    id,
    type: 'default',
    visibility: 'public',
    sourceEntityType: 'communication_channels.external_conversation',
    sourceEntityId: null,
    externalEmail: null,
    externalName: null,
    subject: `Subject ${id}`,
    body: `Body ${id}`,
    senderUserId,
    priority: null,
    actionData: null,
    actionTaken: null,
    sentAt: new Date('2026-01-01T00:00:00Z'),
    threadId: id,
  } as unknown as Partial<Message>
}

import { GET } from '../route'

function makeContainer(options: { hub: boolean }) {
  const em = {
    getKysely: () => createRecordingKysely(),
    find: jest.fn(async () => []),
  }
  return {
    resolve: (name: string) => {
      if (name === 'em') return em
      if (name === 'communicationChannelsBuildChannelInboxPredicate') {
        if (!options.hub) throw new Error('not registered')
        return buildChannelInboxPredicate
      }
      return null
    },
  }
}

function scopeSql(): string {
  const query = recordedQueries.find(isScopeQuery)
  expect(query).toBeDefined()
  return query!.sql.replace(/\s+/g, ' ')
}

function scopeParameters(): readonly unknown[] {
  return recordedQueries.find(isScopeQuery)!.parameters
}

function arrange(options: { hub?: boolean; granted?: boolean; rows?: Array<Record<string, unknown>> } = {}) {
  canUseChannelThreadFallbackMock.mockResolvedValue(options.granted ?? true)
  scopeRows = options.rows ?? []
  resolveMessageContextMock.mockResolvedValue({
    ctx: { container: makeContainer({ hub: options.hub ?? true }) },
    scope: { tenantId, organizationId: orgId, userId: operatorId },
  })
}

beforeEach(() => {
  recordedQueries.length = 0
  cacheGetMock.mockReset()
  cacheSetMock.mockReset()
  cacheGetMock.mockResolvedValue(undefined)
  findWithDecryptionMock.mockReset()
  findWithDecryptionMock.mockImplementation(
    async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
      if (entity === Message) {
        const ids = (where as any)?.id?.$in as string[] | undefined
        return (ids ?? []).map((id) => makeMessage(id, systemSenderId))
      }
      return []
    },
  )
})

describe('messages GET — channel-inbox widening (#6106)', () => {
  it('inbox: lists inbound messages on unassigned channel conversations the caller has no recipient row for', async () => {
    arrange()

    const res = await GET(new Request('http://localhost/api/messages?folder=inbox'))
    expect(res.status).toBe(200)

    const text = scopeSql()
    // recipient branch OR widened branch
    expect(text).toMatch(/"r"\."message_id" is not null and "r"\."deleted_at" is null and "r"\."archived_at" is null\) or \("m"\."visibility" = \$\d+ and/)
    // hub predicate: inbound + unassigned + channel-owner rule
    expect(text).toContain('"mcl"."direction" = $')
    expect(text).toContain('"ctm"."assigned_user_id" is null')
    expect(text).toContain('"cc"."deleted_at" is null')
    expect(text).toMatch(/\("cc"\."user_id" is null or "cc"\."user_id" = \$\d+\)/)
    // never wider than the read rule: public + external-conversation source
    expect(scopeParameters()).toEqual(
      expect.arrayContaining(['public', 'communication_channels.external_conversation', 'inbound']),
    )
    // the caller has no recipient row at all (deleted included)
    expect(text).toMatch(/not exists \(select 1 as "one" from "message_recipients" as "rx" where "rx"\."message_id" = "m"\."id" and "rx"\."recipient_user_id" = \$\d+\)/)
  })

  it('all: shares the same widening through the participant scope', async () => {
    arrange()

    await GET(new Request('http://localhost/api/messages?folder=all'))

    const text = scopeSql()
    expect(text).toContain('"m"."sender_user_id" = $')
    expect(text).toContain('"mcl"."direction" = $')
    expect(text).toContain('"ctm"."assigned_user_id" is null')
    expect(text).toMatch(/not exists \(select 1 as "one" from "message_recipients" as "rx"/)
  })

  it.each(['sent', 'drafts', 'archived'])('%s: never widened', async (folder) => {
    arrange()

    await GET(new Request(`http://localhost/api/messages?folder=${folder}`))

    const text = scopeSql()
    expect(text).not.toContain('message_channel_links')
    expect(text).not.toContain('channel_thread_mappings')
  })

  it('does not widen without messages.view, and keeps the list cache', async () => {
    arrange({ granted: false })

    await GET(new Request('http://localhost/api/messages?folder=inbox'))

    const text = scopeSql()
    expect(text).not.toContain('message_channel_links')
    expect(text).not.toContain('channel_thread_mappings')
    expect(cacheGetMock).toHaveBeenCalled()
    expect(cacheSetMock).toHaveBeenCalled()
  })

  it('does not widen when the channels hub is not installed', async () => {
    arrange({ hub: false })

    await GET(new Request('http://localhost/api/messages?folder=all'))

    expect(scopeSql()).not.toContain('message_channel_links')
  })

  it('bypasses the list cache whenever the widening applies', async () => {
    arrange()

    await GET(new Request('http://localhost/api/messages?folder=inbox'))

    expect(cacheGetMock).not.toHaveBeenCalled()
    expect(cacheSetMock).not.toHaveBeenCalled()
  })

  it('status=unread keeps rows that have no recipient row yet', async () => {
    arrange()

    await GET(new Request('http://localhost/api/messages?folder=inbox&status=unread'))

    const text = scopeSql()
    expect(text).toMatch(/"r"\."status" = \$\d+ or \("m"\."visibility" = \$\d+ and/)
  })

  it('status=read stays a plain recipient filter', async () => {
    arrange()

    await GET(new Request('http://localhost/api/messages?folder=inbox&status=read'))

    expect(scopeSql()).toMatch(/and "r"\."status" = \$\d+/)
    expect(scopeSql()).not.toMatch(/"r"\."status" = \$\d+ or \(/)
  })

  it('reports a row without a recipient row as unread, so a new customer message is flagged as new', async () => {
    arrange({
      rows: [
        { id: 'inbound-1', sender_user_id: systemSenderId, is_draft: false, recipient_status: null, read_at: null },
        { id: 'opened-1', sender_user_id: systemSenderId, is_draft: false, recipient_status: 'read', read_at: '2026-01-02' },
      ],
    })

    const res = await GET(new Request('http://localhost/api/messages?folder=inbox'))
    const body = (await res.json()) as { items: Array<{ id: string; status: string }> }

    expect(body.items.map((item) => [item.id, item.status])).toEqual([
      ['inbound-1', 'unread'],
      ['opened-1', 'read'],
    ])
  })

  it('keeps `sent` for the caller own message without a recipient row', async () => {
    arrange({
      rows: [{ id: 'mine-1', sender_user_id: operatorId, is_draft: false, recipient_status: null, read_at: null }],
    })
    findWithDecryptionMock.mockImplementation(async (_em: unknown, entity: unknown) =>
      entity === Message ? [makeMessage('mine-1', operatorId)] : [],
    )

    const res = await GET(new Request('http://localhost/api/messages?folder=all'))
    const body = (await res.json()) as { items: Array<{ id: string; status: string }> }

    expect(body.items).toEqual([expect.objectContaining({ id: 'mine-1', status: 'sent' })])
  })
})
