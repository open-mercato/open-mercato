import setPrimaryChannelCommand, {
  COMMUNICATION_CHANNELS_SET_PRIMARY_COMMAND_ID,
} from '../set-primary-channel'

describe('setPrimaryChannelCommand metadata', () => {
  it('exports stable canonical command id', () => {
    expect(COMMUNICATION_CHANNELS_SET_PRIMARY_COMMAND_ID).toBe(
      'communication_channels.channel.set_primary',
    )
    expect(setPrimaryChannelCommand.id).toBe(COMMUNICATION_CHANNELS_SET_PRIMARY_COMMAND_ID)
  })
})

describe('setPrimaryChannelCommand schema', () => {
  function emptyCtx() {
    return {
      container: { resolve: () => null } as any,
      auth: null,
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
    }
  }

  it('rejects malformed channelId', async () => {
    await expect(
      setPrimaryChannelCommand.execute(
        {
          channelId: 'not-a-uuid',
          userId: '11111111-1111-1111-1111-111111111111',
          scope: { tenantId: '22222222-2222-2222-2222-222222222222', organizationId: null },
        } as never,
        emptyCtx(),
      ),
    ).rejects.toThrow()
  })

  it('rejects malformed userId', async () => {
    await expect(
      setPrimaryChannelCommand.execute(
        {
          channelId: '11111111-1111-1111-1111-111111111111',
          userId: 'not-a-uuid',
          scope: { tenantId: '22222222-2222-2222-2222-222222222222', organizationId: null },
        } as never,
        emptyCtx(),
      ),
    ).rejects.toThrow()
  })
})

describe('setPrimaryChannelCommand channel status', () => {
  const input = {
    channelId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    scope: { tenantId: '33333333-3333-4333-8333-333333333333', organizationId: null },
  }

  function makeCtx(channel: Record<string, unknown>) {
    const em = {
      findOne: jest.fn(async () => channel),
      find: jest.fn(async () => []),
      flush: jest.fn(async () => undefined),
      begin: jest.fn(async () => undefined),
      commit: jest.fn(async () => undefined),
      rollback: jest.fn(async () => undefined),
    }
    return {
      em,
      ctx: {
        container: {
          resolve: ((name: string) => (name === 'em' ? { fork: () => em } : null)) as <T>(name: string) => T,
        },
        auth: null,
        organizationScope: null,
        selectedOrganizationId: null,
        organizationIds: null,
      } as never,
    }
  }

  it('refuses a disconnected channel without writing anything', async () => {
    const channel = { id: input.channelId, userId: input.userId, isPrimary: false, status: 'disconnected', isActive: false }
    const { ctx, em } = makeCtx(channel)
    const result = await setPrimaryChannelCommand.execute(input, ctx)
    expect(result.status).toBe('disconnected')
    expect(channel.isPrimary).toBe(false)
    expect(em.find).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('refuses a disconnected channel even when it is still flagged primary', async () => {
    const { ctx, em } = makeCtx({ id: input.channelId, userId: input.userId, isPrimary: true, status: 'disconnected' })
    const result = await setPrimaryChannelCommand.execute(input, ctx)
    expect(result.status).toBe('disconnected')
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('keeps reporting an already-primary connected channel as a noop', async () => {
    const { ctx, em } = makeCtx({ id: input.channelId, userId: input.userId, isPrimary: true, status: 'connected' })
    const result = await setPrimaryChannelCommand.execute(input, ctx)
    expect(result.status).toBe('noop')
    expect(em.flush).not.toHaveBeenCalled()
  })

  it.each(['connected', 'requires_reauth', 'error'])('still sets a %s channel as primary', async (status) => {
    const channel = { id: input.channelId, userId: input.userId, isPrimary: false, status, isActive: true }
    const { ctx } = makeCtx(channel)
    const result = await setPrimaryChannelCommand.execute(input, ctx)
    expect(result).toEqual({ status: 'set', channelId: input.channelId, previousPrimaryChannelId: null })
    expect(channel.isPrimary).toBe(true)
  })

  it('keeps reporting a channel owned by someone else as not_owner', async () => {
    const { ctx } = makeCtx({
      id: input.channelId,
      userId: '44444444-4444-4444-8444-444444444444',
      isPrimary: false,
      status: 'disconnected',
    })
    const result = await setPrimaryChannelCommand.execute(input, ctx)
    expect(result.status).toBe('not_owner')
  })
})
