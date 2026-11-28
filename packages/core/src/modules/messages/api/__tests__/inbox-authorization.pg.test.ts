import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { Client, Pool } from 'pg'
import { Kysely, PostgresDialect, type CompiledQuery } from 'kysely'
import { createCacheService, runWithCacheTenant } from '@open-mercato/cache'
import { buildChannelInboxPredicate } from '../../../communication_channels/lib/channel-inbox-predicate'
import { enrichers } from '../../../communication_channels/data/enrichers'
import { Message } from '../../data/entities'
import { listMessagesSchema } from '../../data/validators'
import { MessageReaction } from '../../../communication_channels/data/entities'
import type { MessagesParticipantScopeDatabase } from '../../lib/participantScope'
import { GET as list } from '../route'
import { GET as unread } from '../unread-count/route'

const resolveMessageContextMock = jest.fn<(...args: unknown[]) => Promise<unknown>>()
const findWithDecryptionMock = jest.fn<(
  em: unknown,
  entity: unknown,
  where: { id?: { $in?: string[] }; messageId?: { $in?: string[] } },
) => Promise<unknown[]>>()

jest.mock('@open-mercato/core/modules/messages/lib/routeHelpers', () => ({
  ...jest.requireActual<typeof import('../../lib/routeHelpers')>('@open-mercato/core/modules/messages/lib/routeHelpers'),
  resolveMessageContext: (...args: unknown[]) => resolveMessageContextMock(...args),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  ...jest.requireActual<typeof import('@open-mercato/shared/lib/encryption/find')>('@open-mercato/shared/lib/encryption/find'),
  findWithDecryption: (...args: Parameters<typeof findWithDecryptionMock>) => findWithDecryptionMock(...args),
}))

const describePg = process.env.OM_CHANNEL_INBOX_PG_URL ? describe : describe.skip
const tenantId = randomUUID()
const organizationId = randomUUID()
const userId = randomUUID()
const senderId = randomUUID()
const channelId = randomUUID()
const conversationId = randomUUID()
const threadId = randomUUID()
const widenedId = randomUUID()
const recipientId = randomUUID()
const schema = `inbox_routes_${randomUUID().replace(/-/g, '')}`
const request = (folder: string) => new Request(`http://localhost/api/messages?folder=${folder}`)
const countRequest = () => new Request('http://localhost/api/messages/unread-count')

type ListPayload = { items: Array<{ id: string; status: string; readAt: string | null }>; total: number; page: number; pageSize: number; totalPages: number }

function legacyListKey(folder: string) {
  const input = listMessagesSchema.parse({ folder })
  const canonical = Object.entries(input).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => [key, value ?? null])
  const signature = createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 32)
  return `messages:list:v1|tenant:${tenantId}|org:${organizationId}|user:${userId}|filters:${signature}`
}

describePg('actual inbox routes with PostgreSQL and warm legacy caches', () => {
  const originalCacheFlag = process.env.ENABLE_CRUD_API_CACHE
  let client: Client
  let db: Kysely<MessagesParticipantScopeDatabase>
  let created = false
  let featuresGranted = true
  let afterAggregate: (() => Promise<void>) | undefined
  const statements: CompiledQuery[] = []
  const cache = createCacheService({ strategy: 'memory' })
  const cacheGet = jest.spyOn(cache, 'get')
  const cacheSet = jest.spyOn(cache, 'set')
  const rbac = { userHasAllFeatures: jest.fn(async (
    _userId: string,
    _required: string[],
    _scope: { tenantId: string | null; organizationId: string | null },
  ) => featuresGranted) }
  const em = { getKysely: () => db, find: jest.fn(async () => []) }
  const container = { resolve: (name: string) => {
    if (name === 'em') return em
    if (name === 'cache') return cache
    if (name === 'rbacService') return rbac
    if (name === 'communicationChannelsBuildChannelInboxPredicate') return buildChannelInboxPredicate
    throw new Error(`[internal] Unexpected test dependency ${name}`)
  } }

  beforeAll(async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    client = new Client({ connectionString: process.env.OM_CHANNEL_INBOX_PG_URL, connectionTimeoutMillis: 5000, query_timeout: 10000 })
    await client.connect()
    await client.query(`create schema "${schema}"`)
    created = true
    await client.query(`set search_path to "${schema}"`)
    await client.query(`
      create table messages (id uuid primary key, thread_id uuid, sender_user_id uuid, tenant_id uuid, organization_id uuid, deleted_at timestamptz, is_draft boolean default false, visibility text default 'public', source_entity_type text default 'communication_channels.external_conversation', source_entity_id uuid, external_email_hash text, type text default 'default', action_data jsonb, sent_at timestamptz default now());
      create table message_recipients (message_id uuid, recipient_user_id uuid, status text default 'unread', deleted_at timestamptz, archived_at timestamptz, read_at timestamptz, unique(message_id,recipient_user_id));
      create table attachments (record_id text, entity_id text);
      create table message_objects (message_id uuid);
      create table communication_channels (id uuid, tenant_id uuid, organization_id uuid, user_id uuid, deleted_at timestamptz);
      create table external_conversations (id uuid, channel_id uuid, tenant_id uuid, organization_id uuid);
      create table channel_thread_mappings (external_conversation_id uuid, message_thread_id uuid, channel_id uuid, tenant_id uuid, organization_id uuid, assigned_user_id uuid);
      create table message_channel_links (message_id uuid, external_conversation_id uuid, direction text, tenant_id uuid, organization_id uuid);
    `)
    db = new Kysely<MessagesParticipantScopeDatabase>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: process.env.OM_CHANNEL_INBOX_PG_URL, max: 1, connectionTimeoutMillis: 5000, statement_timeout: 10000, options: `-c search_path=${schema}` }) }),
      log: async (event) => {
        if (event.level !== 'query') return
        statements.push(event.query)
        if (afterAggregate && event.query.sql.includes('count(*)') && event.query.sql.includes('"messages" as "m"')) {
          const materialize = afterAggregate
          afterAggregate = undefined
          await materialize()
        }
      },
    })
    findWithDecryptionMock.mockImplementation(async (_em: unknown, entity: unknown, where: { id?: { $in?: string[] }; messageId?: { $in?: string[] } }) => {
      if (entity === Message) return (where.id?.$in ?? []).map(id => ({ id, senderUserId: senderId, type: 'default', visibility: 'public', subject: id, body: `fixture preview ${id}`, threadId, sentAt: new Date('2026-01-01T00:00:00Z') }))
      if (entity === MessageReaction) return (where.messageId?.$in ?? []).map(messageId => ({ messageId, emoji: 'test', reactedByUserId: userId, providerKey: 'test' }))
      return []
    })
  })

  beforeEach(async () => {
    featuresGranted = true
    afterAggregate = undefined
    statements.length = 0
    await runWithCacheTenant(tenantId, () => cache.clear())
    cacheGet.mockClear()
    cacheSet.mockClear()
    rbac.userHasAllFeatures.mockClear()
    resolveMessageContextMock.mockResolvedValue({ ctx: { container }, scope: { userId, tenantId, organizationId } })
    await client.query('truncate messages, message_recipients, message_channel_links, channel_thread_mappings, external_conversations, communication_channels')
    await client.query('insert into communication_channels values ($1,$2,$3,null,null)', [channelId, tenantId, organizationId])
    await client.query('insert into external_conversations values ($1,$2,$3,$4)', [conversationId, channelId, tenantId, organizationId])
    await client.query('insert into channel_thread_mappings values ($1,$2,$3,$4,$5,null)', [conversationId, threadId, channelId, tenantId, organizationId])
    for (const id of [widenedId, recipientId]) {
      await client.query('insert into messages(id,thread_id,sender_user_id,tenant_id,organization_id) values ($1,$2,$3,$4,$5)', [id, threadId, senderId, tenantId, organizationId])
      await client.query('insert into message_channel_links values ($1,$2,\'inbound\',$3,$4)', [id, conversationId, tenantId, organizationId])
    }
    await client.query('insert into message_recipients(message_id,recipient_user_id) values ($1,$2)', [recipientId, userId])
  })

  afterAll(async () => {
    try {
      if (db) await db.destroy()
      if (created) await client.query(`drop schema "${schema}" cascade`)
    } finally {
      await client?.end()
      if (originalCacheFlag === undefined) delete process.env.ENABLE_CRUD_API_CACHE
      else process.env.ENABLE_CRUD_API_CACHE = originalCacheFlag
    }
  })

  it.each(['sharing', 'assignment', 'effective feature'])('denies widened previews and counts after %s revocation despite warmed caches', async (revocation) => {
    const payloads = new Map<string, ListPayload>()
    for (const folder of ['inbox', 'all']) {
      const payload: ListPayload = await (await list(request(folder))).json()
      expect(payload.items.map(item => item.id).sort()).toEqual([widenedId, recipientId].sort())
      payloads.set(folder, payload)
      await runWithCacheTenant(tenantId, () => cache.set(legacyListKey(folder), payload))
    }
    await expect((await unread(countRequest())).json()).resolves.toEqual({ unreadCount: 2 })
    await runWithCacheTenant(tenantId, () => cache.set(`messages:unread-count:u=${userId}:org=${organizationId}`, 2))
    if (revocation === 'sharing') await client.query('update communication_channels set user_id=$1', [senderId])
    if (revocation === 'assignment') await client.query('update channel_thread_mappings set assigned_user_id=$1', [senderId])
    if (revocation === 'effective feature') featuresGranted = false
    cacheGet.mockClear()
    cacheSet.mockClear()
    for (const folder of ['inbox', 'all']) {
      const payload: ListPayload = await (await list(request(folder))).json()
      expect(payload.items.map(item => item.id)).toEqual([recipientId])
      expect(payload.total).toBe(1)
    }
    await expect((await unread(countRequest())).json()).resolves.toEqual({ unreadCount: 1 })
    if (revocation === 'effective feature') {
      expect(cacheGet).toHaveBeenCalledTimes(3)
      expect(cacheSet).toHaveBeenCalledTimes(3)
      const executed = statements.length
      await expect((await unread(countRequest())).json()).resolves.toEqual({ unreadCount: 1 })
      for (const folder of ['inbox', 'all']) {
        const cached: ListPayload = await (await list(request(folder))).json()
        expect(cached.items.map(item => item.id)).toEqual([recipientId])
      }
      expect(statements).toHaveLength(executed)
    } else {
      expect(cacheGet).not.toHaveBeenCalled()
      expect(cacheSet).not.toHaveBeenCalled()
    }
    expect(rbac.userHasAllFeatures).toHaveBeenCalledWith(userId, ['messages.view'], { tenantId, organizationId })
    for (const folder of ['inbox', 'all']) {
      expect(await runWithCacheTenant(tenantId, () => cache.get(legacyListKey(folder)))).toEqual(payloads.get(folder))
    }
  })

  it('executes one count statement while an independent connection materializes an unread recipient at the old statement boundary', async () => {
    await client.query('delete from message_recipients')
    await client.query('delete from messages where id=$1', [recipientId])
    await client.query('delete from message_channel_links where message_id=$1', [recipientId])
    let materialized = false
    afterAggregate = async () => {
      await client.query('insert into message_recipients(message_id,recipient_user_id) values ($1,$2)', [widenedId, userId])
      materialized = true
    }
    statements.length = 0
    await expect((await unread(countRequest())).json()).resolves.toEqual({ unreadCount: 1 })
    expect(materialized).toBe(true)
    expect(statements).toHaveLength(1)
    await expect((await unread(countRequest())).json()).resolves.toEqual({ unreadCount: 1 })
  })

  it.each([
    ['unopened', '', 1],
    ['unread recipient counted once', 'insert into message_recipients(message_id,recipient_user_id) values ($1,$2)', 1],
    ['read', "insert into message_recipients(message_id,recipient_user_id,status) values ($1,$2,'read')", 0],
    ['archived', 'insert into message_recipients(message_id,recipient_user_id,archived_at) values ($1,$2,now())', 0],
    ['deleted recipient', 'insert into message_recipients(message_id,recipient_user_id,deleted_at) values ($1,$2,now())', 0],
    ['unopened draft', 'update messages set is_draft=true where id=$1', 0],
    ['deleted message', 'update messages set deleted_at=now() where id=$1', 0],
    ['other tenant', 'update messages set tenant_id=gen_random_uuid() where id=$1', 0],
    ['other organization', 'update messages set organization_id=gen_random_uuid() where id=$1', 0],
    ['internal note', "update messages set visibility='internal' where id=$1", 0],
  ])('retains count filter: %s', async (_name, mutation, expected) => {
    await client.query('delete from message_recipients')
    await client.query('delete from messages where id=$1', [recipientId])
    if (mutation) await client.query(mutation, mutation.includes('$2') ? [widenedId, userId] : [widenedId])
    statements.length = 0
    await expect((await unread(countRequest())).json()).resolves.toEqual({ unreadCount: expected })
    expect(statements).toHaveLength(1)
  })

  it('retains the original recipient branch draft behavior', async () => {
    featuresGranted = false
    await client.query('update messages set is_draft=true')
    await expect((await unread(countRequest())).json()).resolves.toEqual({ unreadCount: 1 })
  })

  it('reflects an out-of-band recipient read update immediately despite a warmed Inbox payload', async () => {
    const cold: ListPayload = await (await list(request('inbox'))).json()
    await runWithCacheTenant(tenantId, () => cache.set(legacyListKey('inbox'), cold))
    const readAt = '2026-01-02T00:00:00.000Z'
    await client.query("update message_recipients set status='read',read_at=$1 where message_id=$2 and recipient_user_id=$3", [readAt, recipientId, userId])
    const refreshed: ListPayload = await (await list(request('inbox'))).json()
    expect(refreshed.total).toBe(cold.total)
    expect(refreshed.items.find(item => item.id === recipientId)).toMatchObject({ status: 'read', readAt })
    expect(refreshed.items.find(item => item.id === widenedId)).toMatchObject({ status: 'unread', readAt: null })
  })

  it.each(['sent', 'drafts', 'archived'])('retains cache hits for unaffected %s folder', async (folder) => {
    featuresGranted = false
    if (folder === 'archived') await client.query('update message_recipients set archived_at=now()')
    else await client.query('update messages set sender_user_id=$1,is_draft=$2 where id=$3', [userId, folder === 'drafts', widenedId])
    const expectedId = folder === 'archived' ? recipientId : widenedId
    const payload: ListPayload = await (await list(request(folder))).json()
    expect(payload.items.map(item => item.id)).toEqual([expectedId])
    expect(cacheSet).toHaveBeenCalledTimes(1)
    const statementCount = statements.length
    cacheGet.mockClear()
    const cached: ListPayload = await (await list(request(folder))).json()
    expect(cached).toEqual(payload)
    expect(cacheGet).toHaveBeenCalledTimes(1)
    expect(statements).toHaveLength(statementCount)
  })

  it('runs the actual reaction enricher against the same typed participant boundary after revocation', async () => {
    const enricher = enrichers.find(entry => entry.id === 'communication_channels.message-reactions')
    if (!enricher?.enrichMany) throw new Error('[internal] Missing reaction enricher')
    const ctx = { container, em, userId, tenantId, organizationId }
    const records = [{ id: widenedId }, { id: recipientId }]
    const allowed = await enricher.enrichMany(records, ctx)
    expect(allowed.every(row => Array.isArray(row._reactions) && row._reactions.length === 1)).toBe(true)
    featuresGranted = false
    const denied = await enricher.enrichMany(records, ctx)
    expect(denied.find(row => row.id === widenedId)?._reactions).toEqual([])
    expect(denied.find(row => row.id === recipientId)?._reactions).toHaveLength(1)
  })

  it('keeps participant-only enrichment when the container has no resolver', async () => {
    const enricher = enrichers.find(entry => entry.id === 'communication_channels.message-reactions')
    if (!enricher?.enrichMany) throw new Error('[internal] Missing reaction enricher')
    const result = await enricher.enrichMany([{ id: widenedId }, { id: recipientId }], { container: null, em, userId, tenantId, organizationId })
    expect(result.find(row => row.id === widenedId)?._reactions).toEqual([])
    expect(result.find(row => row.id === recipientId)?._reactions).toHaveLength(1)
  })
})
