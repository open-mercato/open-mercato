import {
  ChannelMutationBlockedError,
  guardChannelDelete,
  guardOutboundCreate,
} from '../mutation-guards'

const scope = { tenantId: '11111111-1111-1111-1111-111111111111', organizationId: null }

function makeEm(opts: {
  channel: Record<string, unknown> | null
  unreadCount?: number
}) {
  // `countUnreadInboundForChannel` now uses the ORM directly — `em.find` for the
  // ExternalConversation lookup and `em.count` for the link tally. The stub
  // returns one synthetic conversation id so the count code path executes; the
  // `em.count` result drives the assertion.
  const em: Record<string, unknown> = {
    findOne: jest.fn(async () => opts.channel),
    find: jest.fn(async () => (opts.channel ? [{ id: 'conv-1' }] : [])),
    count: jest.fn(async () => opts.unreadCount ?? 0),
  }
  return em as unknown as Parameters<typeof guardChannelDelete>[0]
}

describe('guardChannelDelete', () => {
  it('throws channel_not_found when the channel is missing', async () => {
    await expect(
      guardChannelDelete(makeEm({ channel: null }), { channelId: 'no-such', scope }),
    ).rejects.toMatchObject({ name: 'ChannelMutationBlockedError', reason: 'channel_not_found' })
  })

  it('blocks delete when inbound history exists', async () => {
    const em = makeEm({ channel: { id: 'ch-1' }, unreadCount: 3 })
    let thrown: unknown
    try {
      await guardChannelDelete(em, { channelId: 'ch-1', scope })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(ChannelMutationBlockedError)
    // Round-2 F8 rename (2026-05-26): was `channel_has_unread_inbound`. The
    // helper never counted unread state — it counts ANY inbound link.
    expect((thrown as ChannelMutationBlockedError).reason).toBe('channel_has_inbound_history')
    expect((thrown as ChannelMutationBlockedError).errors.channelId).toMatch(/3 inbound/)
  })

  it('permits delete when no inbound history exists', async () => {
    const em = makeEm({ channel: { id: 'ch-1' }, unreadCount: 0 })
    await expect(guardChannelDelete(em, { channelId: 'ch-1', scope })).resolves.toBeUndefined()
  })

  it('force=true bypasses the inbound-history check', async () => {
    const em = makeEm({ channel: { id: 'ch-1' }, unreadCount: 99 })
    await expect(
      guardChannelDelete(em, { channelId: 'ch-1', scope, force: true }),
    ).resolves.toBeUndefined()
  })
})

describe('guardOutboundCreate', () => {
  it('throws channel_not_found when channel is missing', async () => {
    await expect(
      guardOutboundCreate(makeEm({ channel: null }), { channelId: 'no-such', scope }),
    ).rejects.toMatchObject({ name: 'ChannelMutationBlockedError', reason: 'channel_not_found' })
  })

  it('blocks when channel.status is requires_reauth (422-shaped error)', async () => {
    const em = makeEm({ channel: { id: 'ch-1', status: 'requires_reauth' } })
    let thrown: unknown
    try {
      await guardOutboundCreate(em, { channelId: 'ch-1', scope })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(ChannelMutationBlockedError)
    expect((thrown as ChannelMutationBlockedError).reason).toBe('channel_requires_reauth')
    expect((thrown as ChannelMutationBlockedError).errors.channelId).toMatch(/reconnection/i)
  })

  it('blocks when channel.status is disconnected', async () => {
    const em = makeEm({ channel: { id: 'ch-1', status: 'disconnected' } })
    await expect(
      guardOutboundCreate(em, { channelId: 'ch-1', scope }),
    ).rejects.toMatchObject({ reason: 'channel_disconnected' })
  })

  it('permits send when channel.status is connected', async () => {
    const em = makeEm({ channel: { id: 'ch-1', status: 'connected' } })
    await expect(guardOutboundCreate(em, { channelId: 'ch-1', scope })).resolves.toBeUndefined()
  })

  it('attaches errors as a CrudForm-compatible map keyed by channelId', () => {
    const error = new ChannelMutationBlockedError('channel_requires_reauth', 'ch-99', 'Reconnect required')
    expect(error.errors).toEqual({ channelId: 'Reconnect required' })
  })
})
