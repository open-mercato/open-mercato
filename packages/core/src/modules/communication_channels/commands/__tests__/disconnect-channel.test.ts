import disconnectChannelCommand, {
  COMMUNICATION_CHANNELS_DISCONNECT_CHANNEL_COMMAND_ID,
  extractUndoPayload,
} from '../disconnect-channel'

describe('disconnectChannelCommand metadata', () => {
  it('exports the canonical command id', () => {
    expect(COMMUNICATION_CHANNELS_DISCONNECT_CHANNEL_COMMAND_ID).toBe(
      'communication_channels.channel.disconnect',
    )
    expect(disconnectChannelCommand.id).toBe(COMMUNICATION_CHANNELS_DISCONNECT_CHANNEL_COMMAND_ID)
  })
})

describe('disconnectChannelCommand input validation', () => {
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
      disconnectChannelCommand.execute(
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
      disconnectChannelCommand.execute(
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

describe('disconnectChannelCommand behaviour', () => {
  function makeCtxWithChannel(channel: Record<string, unknown> | null) {
    const em = {
      findOne: jest.fn(async () => channel),
      flush: jest.fn(async () => undefined),
    }
    return {
      em,
      ctx: {
        container: {
          resolve: ((name: string) => {
            if (name === 'em') return { fork: () => em }
            return null
          }) as <T>(name: string) => T,
        },
        auth: null,
        organizationScope: null,
        selectedOrganizationId: null,
        organizationIds: null,
      } as never,
    }
  }

  // UUID v4 format: version nibble = 4, variant nibble = 8|9|a|b. Zod v4 enforces
  // both — earlier zod versions tolerated any hex.
  const validInput = {
    channelId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    scope: { tenantId: '33333333-3333-4333-8333-333333333333', organizationId: null },
  }

  it('returns noop when channel is missing', async () => {
    const { ctx } = makeCtxWithChannel(null)
    const result = await disconnectChannelCommand.execute(validInput, ctx)
    expect(result).toMatchObject({ status: 'noop' })
  })

  it('returns not_owner when channel.userId differs', async () => {
    const { ctx } = makeCtxWithChannel({ id: validInput.channelId, userId: 'someone-else' })
    const result = await disconnectChannelCommand.execute(validInput, ctx)
    expect(result).toMatchObject({ status: 'not_owner' })
  })

  it('returns noop when channel is already disconnected', async () => {
    const { ctx } = makeCtxWithChannel({
      id: validInput.channelId,
      userId: validInput.userId,
      status: 'disconnected',
      isActive: false,
    })
    const result = await disconnectChannelCommand.execute(validInput, ctx)
    expect(result).toMatchObject({ status: 'noop' })
  })

  it('disconnects connected channel and captures an undo snapshot', async () => {
    const channel = {
      id: validInput.channelId,
      userId: validInput.userId,
      status: 'connected',
      isActive: true,
      isPrimary: true,
      credentialsRef: 'cred-1',
      lastError: null,
      lastPolledAt: null,
    }
    const { ctx, em } = makeCtxWithChannel(channel)
    const result = await disconnectChannelCommand.execute(validInput, ctx)
    expect(result).toMatchObject({
      status: 'disconnected',
      channelId: channel.id,
      undo: {
        channelId: channel.id,
        previousStatus: 'connected',
        previousIsActive: true,
        previousIsPrimary: true,
        previousCredentialsRef: 'cred-1',
        previousLastError: null,
      },
    })
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(channel.status).toBe('disconnected')
    expect(channel.isActive).toBe(false)
    expect(channel.isPrimary).toBe(false)
    expect(channel.credentialsRef).toBeNull()
    expect(channel.lastError).toBe('user-disconnected')
  })

  it('undo() restores the snapshot fields', async () => {
    const channel = {
      id: validInput.channelId,
      status: 'disconnected',
      isActive: false,
      isPrimary: false,
      credentialsRef: null,
      lastError: 'user-disconnected',
    }
    const em = {
      findOne: jest.fn(async () => channel),
      flush: jest.fn(async () => undefined),
    }
    const ctx = {
      container: {
        resolve: ((name: string) => (name === 'em' ? { fork: () => em } : null)) as <T>(name: string) => T,
      },
    } as never
    // The canonical CommandHandler.undo signature is `undo({ input, ctx, logEntry })`.
    // The shared `extractUndoPayload` helper unwraps the snapshot from
    // `logEntry.commandPayload.undo`.
    await disconnectChannelCommand.undo!({
      input: { channelId: validInput.channelId } as never,
      ctx,
      logEntry: {
        commandPayload: {
          undo: {
            channelId: validInput.channelId,
            tenantId: validInput.scope.tenantId,
            previousStatus: 'connected',
            previousIsActive: true,
            previousIsPrimary: true,
            previousCredentialsRef: 'cred-1',
            previousLastError: null,
          },
        },
      } as never,
    })
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(channel.status).toBe('connected')
    expect(channel.isActive).toBe(true)
    expect(channel.isPrimary).toBe(true)
    expect(channel.credentialsRef).toBe('cred-1')
  })

  // Regression guard: buildLog must persist the undo snapshot under payload.undo,
  // otherwise the command bus mints an undo token but never stores the snapshot
  // and undo() silently no-ops in production (the isolated undo() test above still
  // passes because it feeds the snapshot directly).
  it('buildLog persists the undo snapshot under payload.undo for a disconnected result', async () => {
    const undoSnapshot = {
      channelId: validInput.channelId,
      tenantId: validInput.scope.tenantId,
      previousStatus: 'connected',
      previousIsActive: true,
      previousIsPrimary: true,
      previousCredentialsRef: 'cred-1',
      previousLastError: null,
    }
    const meta = await disconnectChannelCommand.buildLog!({
      input: validInput as never,
      result: { status: 'disconnected', channelId: validInput.channelId, undo: undoSnapshot } as never,
      ctx: {} as never,
      snapshots: {},
    })
    expect(meta).toMatchObject({
      resourceKind: 'communication_channels.channel',
      resourceId: validInput.channelId,
      tenantId: validInput.scope.tenantId,
      payload: { undo: undoSnapshot },
    })
  })

  it('buildLog returns null when there is nothing to undo', async () => {
    expect(
      await disconnectChannelCommand.buildLog!({
        input: validInput as never,
        result: { status: 'noop', reason: 'already disconnected' } as never,
        ctx: {} as never,
        snapshots: {},
      }),
    ).toBeNull()
  })
})

describe('extractUndoPayload', () => {
  it('returns null on non-snapshot values', () => {
    expect(extractUndoPayload(null)).toBeNull()
    expect(extractUndoPayload(undefined)).toBeNull()
    expect(extractUndoPayload(42)).toBeNull()
    expect(extractUndoPayload({ unrelated: true })).toBeNull()
  })

  it('parses the .undo nested shape from command results', () => {
    const snapshot = extractUndoPayload({
      status: 'disconnected',
      channelId: 'unused',
      undo: {
        channelId: 'ch-7',
        previousStatus: 'connected',
        previousIsActive: true,
        previousIsPrimary: false,
        previousCredentialsRef: 'cred-7',
        previousLastError: null,
      },
    })
    expect(snapshot?.channelId).toBe('ch-7')
    expect(snapshot?.previousStatus).toBe('connected')
  })

  it('parses a bare snapshot shape', () => {
    const snapshot = extractUndoPayload({
      channelId: 'ch-8',
      previousStatus: 'connected',
      previousIsActive: true,
      previousIsPrimary: true,
      previousCredentialsRef: null,
      previousLastError: 'transient-error',
    })
    expect(snapshot?.channelId).toBe('ch-8')
    expect(snapshot?.previousLastError).toBe('transient-error')
  })

  it('fills defaults for missing optional fields', () => {
    const snapshot = extractUndoPayload({ channelId: 'ch-9' })
    expect(snapshot).toEqual({
      channelId: 'ch-9',
      previousStatus: 'connected',
      previousIsActive: true,
      previousIsPrimary: false,
      previousCredentialsRef: null,
      previousLastError: null,
    })
  })
})
