import { enrichers } from '../enrichers'
import { CommunicationChannel, ExternalConversation, MessageChannelLink } from '../entities'
import type { ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'
import { applyMessageParticipantScope } from '../../../messages/lib/participantScope'

const findEnricher = (id: string): ResponseEnricher => {
  const e = enrichers.find((x) => x.id === id)
  if (!e) throw new Error(`Enricher ${id} not found in exported array`)
  return e
}

describe('communication_channels enrichers — registration', () => {
  it('exports exactly 2 enrichers, all targeting messages.message', () => {
    expect(enrichers).toHaveLength(2)
    for (const e of enrichers) {
      expect(e.targetEntity).toBe('messages.message')
    }
  })

  it('every enricher is feature-gated by communication_channels.view', () => {
    for (const e of enrichers) {
      expect(e.features).toEqual(['communication_channels.view'])
    }
  })

  it('every enricher implements enrichMany (no N+1)', () => {
    for (const e of enrichers) {
      expect(typeof e.enrichMany).toBe('function')
    }
  })

  it('namespaces enriched fields with `_channel*` / `_reactions` prefixes (fallback shape)', () => {
    for (const e of enrichers) {
      const fallback = (e.fallback ?? {}) as Record<string, unknown>
      const keys = Object.keys(fallback)
      // Every enricher's fallback uses an underscore-prefixed key (per AGENTS.md).
      expect(keys.length).toBeGreaterThan(0)
      for (const key of keys) {
        expect(key.startsWith('_')).toBe(true)
      }
    }
  })

  it('every enricher has a stable id under the communication_channels namespace', () => {
    for (const e of enrichers) {
      expect(e.id.startsWith('communication_channels.')).toBe(true)
    }
  })
})

describe('communication_channels enrichers — short-circuit empty input', () => {
  function ctx() {
    return {
      organizationId: 'org',
      tenantId: 'tenant',
      userId: 'user',
      em: { find: jest.fn(async () => []) },
      container: { resolve: () => null },
    } as any
  }

  it('returns empty array when invoked with no records', async () => {
    for (const e of enrichers) {
      const out = await e.enrichMany!([], ctx())
      expect(out).toEqual([])
    }
  })
})

describe('messageReactionsEnricher — grouping + reactedByMe', () => {
  const enricher = findEnricher('communication_channels.message-reactions')
  const currentUserId = 'user-1'

  function ctx() {
    return {
      organizationId: 'org',
      tenantId: 'tenant',
      userId: currentUserId,
      em: {
        find: jest.fn(async (_entity: unknown) => [
          // 3× thumbsup, one of which is from current user
          { messageId: 'm1', emoji: '👍', reactedByUserId: 'user-1', reactedByExternalId: null, providerKey: 'slack', reactedByDisplayName: null },
          { messageId: 'm1', emoji: '👍', reactedByUserId: null, reactedByExternalId: 'U2', providerKey: 'slack', reactedByDisplayName: 'External 2' },
          { messageId: 'm1', emoji: '👍', reactedByUserId: 'user-3', reactedByExternalId: null, providerKey: 'slack', reactedByDisplayName: null },
          // 1× heart, not from current user
          { messageId: 'm1', emoji: '❤️', reactedByUserId: 'user-4', reactedByExternalId: null, providerKey: 'slack', reactedByDisplayName: null },
        ]),
      },
      container: { resolve: () => null },
    } as any
  }

  it('groups reactions by emoji with correct counts, reactedByMe, and descending count order', async () => {
    const out = await enricher.enrichMany!([{ id: 'm1' }] as any, ctx())
    const reactions = (out[0] as any)._reactions
    expect(reactions).toBeDefined()
    expect(reactions.length).toBe(2)
    expect(reactions[0].emoji).toBe('👍')
    expect(reactions[0].count).toBe(3)
    expect(reactions[0].reactedByMe).toBe(true)
    expect(reactions[1].emoji).toBe('❤️')
    expect(reactions[1].count).toBe(1)
    expect(reactions[1].reactedByMe).toBe(false)
  })
})

describe('messageReactionsEnricher — batched lookup (no N+1)', () => {
  const enricher = findEnricher('communication_channels.message-reactions')

  it('issues a single bounded reaction query regardless of record count', async () => {
    const find = jest.fn(async () => [])
    const ctx = {
      organizationId: 'org',
      tenantId: 'tenant',
      userId: 'user-1',
      em: { find },
      container: { resolve: () => null },
    } as any
    const records = Array.from({ length: 25 }, (_, i) => ({ id: `m-${i}` }))

    const out = await enricher.enrichMany!(records as any, ctx)

    expect(out).toHaveLength(25)
    // A per-record (N+1) implementation would hit the data source 25 times;
    // the batched enricher issues exactly one query for the whole page.
    expect(find).toHaveBeenCalledTimes(1)
  })
})

describe('communication_channels enrichers — no duplicate MessageChannelLink lookups (#3183)', () => {
  // em.find branches on the entity argument so we can count per-entity queries.
  // findWithDecryption is a thin wrapper over em.find(entity, where, options),
  // so each entity passed to findWithDecryption surfaces here as call[0].
  function makeParticipantQuery(rows: Array<{ id: string }>) {
    const joinBuilder: any = {
      onRef: jest.fn(() => joinBuilder),
      on: jest.fn(() => joinBuilder),
    }
    const expressionBuilder: any = jest.fn((...args: unknown[]) => args)
    expressionBuilder.or = jest.fn((expressions: unknown[]) => expressions)
    const query: any = {
      selectFrom: jest.fn(() => query),
      leftJoin: jest.fn((_table: string, join: (builder: any) => unknown) => {
        join(joinBuilder)
        return query
      }),
      select: jest.fn(() => query),
      distinct: jest.fn(() => query),
      where: jest.fn((...args: unknown[]) => {
        if (typeof args[0] === 'function') args[0](expressionBuilder)
        return query
      }),
      execute: jest.fn(async () => rows),
    }
    return { expressionBuilder, joinBuilder, query }
  }

  function makeFind() {
    return jest.fn(async (entity: unknown) => {
      if (entity === MessageChannelLink) {
        return [
          {
            messageId: 'm1',
            externalConversationId: 'c1',
            providerKey: 'slack',
            channelType: 'chat',
            direction: 'inbound',
            deliveryStatus: 'sent',
            channelContentType: 'text',
            channelPayload: { blocks: [] },
            interactiveState: null,
            channelMetadata: null,
          },
          {
            messageId: 'm2',
            externalConversationId: 'c1',
            providerKey: 'slack',
            channelType: 'chat',
            direction: 'outbound',
            deliveryStatus: null,
            channelContentType: null,
            channelPayload: null,
            interactiveState: null,
            channelMetadata: null,
          },
        ]
      }
      if (entity === ExternalConversation) {
        return [{ id: 'c1', channelId: 'ch1', contactPersonId: 'p1', assignedUserId: 'u9', subject: 'Hello' }]
      }
      if (entity === CommunicationChannel) {
        return [{ id: 'ch1', capabilities: { reactions: true } }]
      }
      // MessageReaction → none
      return []
    })
  }

  it('runs the full enrichment pass with a single MessageChannelLink (and ExternalConversation) query', async () => {
    const find = makeFind()
    const { query: participantQuery } = makeParticipantQuery([{ id: 'm1' }, { id: 'm2' }])
    const ctx = {
      organizationId: 'org',
      tenantId: 'tenant',
      userId: 'user-1',
      em: { find, getKysely: () => participantQuery },
      container: { resolve: () => null },
    } as any

    // Mirror the enricher-runner: every active enricher runs sequentially over the
    // same page, threading the progressively enriched records and sharing one em.
    let items: any[] = [{ id: 'm1' }, { id: 'm2' }]
    for (const e of enrichers) {
      items = (await e.enrichMany!(items, ctx)) as any[]
    }

    const linkQueries = find.mock.calls.filter((c) => c[0] === MessageChannelLink)
    const conversationQueries = find.mock.calls.filter((c) => c[0] === ExternalConversation)
    // Before #3183 the channel/payload/contact enrichers each issued their own
    // MessageChannelLink $in query (3 total) and two of them queried
    // ExternalConversation (2 total). A single batched channel enricher loads each
    // batch once per pass.
    expect(linkQueries).toHaveLength(1)
    expect(conversationQueries).toHaveLength(1)
  })

  it('the merged channel enricher produces _channel, _channelPayload and _channelContact in one pass', async () => {
    const find = makeFind()
    const { query: participantQuery } = makeParticipantQuery([{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }])
    const ctx = {
      organizationId: 'org',
      tenantId: 'tenant',
      userId: 'user-1',
      em: { find, getKysely: () => participantQuery },
      container: { resolve: () => null },
    } as any

    const enricher = findEnricher('communication_channels.message-channel')
    const out = (await enricher.enrichMany!(
      [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }] as any,
      ctx,
    )) as any[]

    // m1: link → conversation → channel all resolve.
    expect(out[0]._channel).toMatchObject({
      providerKey: 'slack',
      channelType: 'chat',
      direction: 'inbound',
      deliveryStatus: 'sent',
      capabilities: { reactions: true },
    })
    expect(out[0]._channelPayload).toMatchObject({
      channelContentType: 'text',
      channelPayload: { blocks: [] },
    })
    expect(out[0]._channelContact).toMatchObject({
      contactPersonId: 'p1',
      assignedUserId: 'u9',
      subject: 'Hello',
    })

    // m2: link + resolvable conversation/channel, but it is an outbound payload-less row.
    expect(out[1]._channel).not.toBeNull()
    expect(out[1]._channelPayload).not.toBeNull()
    expect(out[1]._channelContact).toMatchObject({ contactPersonId: 'p1' })

    // m3: no link → every channel field is null.
    expect(out[2]._channel).toBeNull()
    expect(out[2]._channelPayload).toBeNull()
    expect(out[2]._channelContact).toBeNull()
  })

  it('does not enrich channel data for a same-organization non-participant', async () => {
    const find = makeFind()
    const { expressionBuilder, joinBuilder, query: participantQuery } = makeParticipantQuery([{ id: 'm1' }])
    const ctx = {
      organizationId: 'org',
      tenantId: 'tenant',
      userId: 'user-1',
      em: { find, getKysely: () => participantQuery },
      container: { resolve: () => null },
    } as any

    const enricher = findEnricher('communication_channels.message-channel')
    const out = (await enricher.enrichMany!([{ id: 'm1' }, { id: 'm2' }] as any, ctx)) as any[]

    expect(out[0]._channelPayload).toMatchObject({ channelPayload: { blocks: [] } })
    expect(out[1]).toMatchObject({
      _channel: null,
      _channelPayload: null,
      _channelContact: null,
    })

    const linkQuery = find.mock.calls.find(([entity]) => entity === MessageChannelLink)
    expect(linkQuery?.[1]).toMatchObject({ messageId: { $in: ['m1'] } })
    expect(joinBuilder.on).toHaveBeenCalledWith('r.recipient_user_id', '=', 'user-1')
    expect(joinBuilder.on).toHaveBeenCalledWith('r.deleted_at', 'is', null)
    expect(participantQuery.where).toHaveBeenCalledWith('m.tenant_id', '=', 'tenant')
    expect(participantQuery.where).toHaveBeenCalledWith('m.organization_id', '=', 'org')
    expect(participantQuery.where).toHaveBeenCalledWith('m.deleted_at', 'is', null)
    expect(expressionBuilder).toHaveBeenCalledWith('m.sender_user_id', '=', 'user-1')
    expect(expressionBuilder).toHaveBeenCalledWith('r.message_id', 'is not', null)
  })
})

describe('message-channel enricher — participant scope agrees with the list route (#4133)', () => {
  // Records the join conditions and OR-expression terms a Kysely builder emits,
  // so the participant predicate can be compared regardless of call site.
  function makeScopeRecorder() {
    const onRef: unknown[][] = []
    const on: unknown[][] = []
    const or: unknown[][] = []
    const joinBuilder: any = {
      onRef: (...args: unknown[]) => { onRef.push(args); return joinBuilder },
      on: (...args: unknown[]) => { on.push(args); return joinBuilder },
    }
    const expressionBuilder: any = (...args: unknown[]) => { or.push(args); return args }
    expressionBuilder.or = (expressions: unknown[]) => expressions
    const query: any = {
      selectFrom: () => query,
      leftJoin: (_table: string, join: (builder: any) => unknown) => { join(joinBuilder); return query },
      select: () => query,
      distinct: () => query,
      where: (...args: unknown[]) => {
        if (typeof args[0] === 'function') (args[0] as (eb: unknown) => unknown)(expressionBuilder)
        return query
      },
      execute: async () => [{ id: 'm1' }],
    }
    return { query, signature: () => ({ onRef, on, or }) }
  }

  it('the enricher guard and the list route all-folder derive one participant set', async () => {
    const enricher = findEnricher('communication_channels.message-channel')

    // List route `all` folder: it calls the shared helper directly on its query.
    const routeRecorder = makeScopeRecorder()
    applyMessageParticipantScope(routeRecorder.query.selectFrom('messages as m'), 'user-1')

    // Enricher: run its participant guard through a recording Kysely builder.
    const enricherRecorder = makeScopeRecorder()
    await enricher.enrichMany!([{ id: 'm1' }] as any, {
      organizationId: 'org',
      tenantId: 'tenant',
      userId: 'user-1',
      em: { find: jest.fn(async () => []), getKysely: () => enricherRecorder.query },
      container: { resolve: () => null },
    } as any)

    // Both must emit the exact same sender-OR-recipient predicate — a drift in
    // either call site would break this equality.
    expect(enricherRecorder.signature()).toEqual(routeRecorder.signature())
    expect(routeRecorder.signature()).toEqual({
      onRef: [['m.id', '=', 'r.message_id']],
      on: [
        ['r.recipient_user_id', '=', 'user-1'],
        ['r.deleted_at', 'is', null],
      ],
      or: [
        ['m.sender_user_id', '=', 'user-1'],
        ['r.message_id', 'is not', null],
      ],
    })
  })
})
