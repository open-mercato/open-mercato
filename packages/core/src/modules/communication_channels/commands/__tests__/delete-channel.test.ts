import deleteChannelCommand, {
  COMMUNICATION_CHANNELS_DELETE_CHANNEL_COMMAND_ID,
  extractUndoPayload,
} from '../delete-channel'

// Push teardown is a best-effort side effect gated on organizationId; stub it so
// these tests stay focused on the soft-delete + undo behavior.
jest.mock('../push-unregister', () => ({
  pushUnregister: jest.fn(async () => undefined),
}))
import { pushUnregister } from '../push-unregister'
const pushUnregisterMock = pushUnregister as unknown as jest.Mock

// UUID v4 format (version nibble = 4, variant nibble = 8|9|a|b) — zod v4 enforces it.
const validInput = {
  channelId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  scope: { tenantId: '33333333-3333-4333-8333-333333333333', organizationId: null as string | null },
}
const ORG = '44444444-4444-4444-8444-444444444444'

describe('deleteChannelCommand metadata', () => {
  it('exports the canonical command id', () => {
    expect(COMMUNICATION_CHANNELS_DELETE_CHANNEL_COMMAND_ID).toBe('communication_channels.channel.delete')
    expect(deleteChannelCommand.id).toBe(COMMUNICATION_CHANNELS_DELETE_CHANNEL_COMMAND_ID)
  })
})

describe('deleteChannelCommand input validation', () => {
  const emptyCtx = () =>
    ({
      container: { resolve: () => null } as any,
      auth: null,
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
    }) as never

  it('rejects a malformed channelId', async () => {
    await expect(
      deleteChannelCommand.execute(
        { channelId: 'not-a-uuid', userId: validInput.userId, scope: validInput.scope } as never,
        emptyCtx(),
      ),
    ).rejects.toThrow()
  })
})

describe('deleteChannelCommand behaviour', () => {
  function makeCtxWithChannel(channel: Record<string, unknown> | null) {
    const em = {
      findOne: jest.fn(async () => channel),
      flush: jest.fn(async () => undefined),
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

  beforeEach(() => pushUnregisterMock.mockClear())

  it('returns noop when the channel is missing', async () => {
    const { ctx } = makeCtxWithChannel(null)
    expect(await deleteChannelCommand.execute(validInput, ctx)).toMatchObject({ status: 'noop' })
  })

  it('returns not_owner when channel.userId differs from the caller', async () => {
    const { ctx } = makeCtxWithChannel({ id: validInput.channelId, userId: 'someone-else' })
    expect(await deleteChannelCommand.execute(validInput, ctx)).toMatchObject({ status: 'not_owner' })
  })

  it('soft-deletes the channel, clears isPrimary, and returns an undo snapshot', async () => {
    const channel = {
      id: validInput.channelId,
      userId: validInput.userId,
      tenantId: validInput.scope.tenantId,
      isPrimary: true,
      deletedAt: null as Date | null,
    }
    const { ctx, em } = makeCtxWithChannel(channel)
    const result = await deleteChannelCommand.execute(validInput, ctx)
    expect(result).toMatchObject({
      status: 'deleted',
      channelId: channel.id,
      undo: { channelId: channel.id, tenantId: validInput.scope.tenantId },
    })
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(channel.deletedAt).toBeInstanceOf(Date)
    expect(channel.isPrimary).toBe(false)
  })

  it('skips push teardown when organizationId is null', async () => {
    const channel = { id: validInput.channelId, userId: validInput.userId, tenantId: validInput.scope.tenantId, isPrimary: false, deletedAt: null }
    const { ctx } = makeCtxWithChannel(channel)
    await deleteChannelCommand.execute(validInput, ctx)
    expect(pushUnregisterMock).not.toHaveBeenCalled()
  })

  it('tears down push delivery (best-effort) when organizationId is present', async () => {
    const channel = { id: validInput.channelId, userId: validInput.userId, tenantId: validInput.scope.tenantId, isPrimary: false, deletedAt: null }
    const { ctx } = makeCtxWithChannel(channel)
    await deleteChannelCommand.execute(
      { ...validInput, scope: { tenantId: validInput.scope.tenantId, organizationId: ORG } },
      ctx,
    )
    expect(pushUnregisterMock).toHaveBeenCalledTimes(1)
  })

  it('undo() clears deletedAt to restore the row', async () => {
    const channel = { id: validInput.channelId, deletedAt: new Date() as Date | null, isPrimary: false }
    const em = { findOne: jest.fn(async () => channel), find: jest.fn(async () => []), flush: jest.fn(async () => undefined) }
    const ctx = {
      container: { resolve: ((name: string) => (name === 'em' ? { fork: () => em } : null)) as <T>(name: string) => T },
    } as never
    await deleteChannelCommand.undo!({
      input: { channelId: validInput.channelId } as never,
      ctx,
      logEntry: {
        commandPayload: { undo: { channelId: validInput.channelId, tenantId: validInput.scope.tenantId } },
      } as never,
    })
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(channel.deletedAt).toBeNull()
  })

  it('undo() no-ops when the snapshot lacks a tenantId (cross-tenant guard)', async () => {
    const em = { findOne: jest.fn(async () => ({})), flush: jest.fn(async () => undefined) }
    const ctx = {
      container: { resolve: ((name: string) => (name === 'em' ? { fork: () => em } : null)) as <T>(name: string) => T },
    } as never
    await deleteChannelCommand.undo!({
      input: {} as never,
      ctx,
      logEntry: { commandPayload: { undo: { channelId: validInput.channelId } } } as never,
    })
    expect(em.flush).not.toHaveBeenCalled()
  })

  // Regression guard: without buildLog the command bus mints an undo token but
  // never persists the snapshot, so undo() silently no-ops in production while
  // the isolated undo() tests above still pass. buildLog must surface the snapshot
  // under `payload.undo` (the shape extractUndoPayload reads back).
  it('buildLog persists the undo snapshot under payload.undo for a deleted result', async () => {
    const undoSnapshot = { channelId: validInput.channelId, tenantId: validInput.scope.tenantId }
    const meta = await deleteChannelCommand.buildLog!({
      input: validInput as never,
      result: { status: 'deleted', channelId: validInput.channelId, undo: undoSnapshot } as never,
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

  it('buildLog returns null when there is nothing to undo (noop/not_owner)', async () => {
    expect(
      await deleteChannelCommand.buildLog!({
        input: validInput as never,
        result: { status: 'noop', reason: 'channel not found' } as never,
        ctx: {} as never,
        snapshots: {},
      }),
    ).toBeNull()
  })
})

describe('deleteChannelCommand undo against a newer connection', () => {
  const OTHER_ID = '55555555-5555-4555-8555-555555555555'

  function deletedChannel(overrides: Record<string, unknown> = {}) {
    return {
      id: validInput.channelId,
      tenantId: validInput.scope.tenantId,
      userId: validInput.userId,
      providerKey: 'discord',
      channelType: 'chat',
      externalIdentifier: null as string | null,
      isPrimary: false,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      deletedAt: new Date('2026-02-01T00:00:00Z') as Date | null,
      ...overrides,
    }
  }

  function activeChannel(overrides: Record<string, unknown> = {}) {
    return { ...deletedChannel(), id: OTHER_ID, createdAt: new Date('2026-02-02T00:00:00Z'), deletedAt: null, ...overrides }
  }

  async function runUndo(channel: Record<string, unknown>, active: Array<Record<string, unknown>>) {
    const em = {
      findOne: jest.fn(async () => channel),
      find: jest.fn(async () => active),
      flush: jest.fn(async () => undefined),
    }
    const ctx = {
      container: { resolve: ((name: string) => (name === 'em' ? { fork: () => em } : null)) as <T>(name: string) => T },
    } as never
    const outcome = await deleteChannelCommand
      .undo!({
        input: { channelId: validInput.channelId } as never,
        ctx,
        logEntry: {
          commandPayload: { undo: { channelId: validInput.channelId, tenantId: validInput.scope.tenantId } },
        } as never,
      })
      .then(
        () => null,
        (err: unknown) => err,
      )
    return { em, outcome }
  }

  it('refuses to restore an identifier-less channel once the same provider was reconnected', async () => {
    const channel = deletedChannel()
    const { em, outcome } = await runUndo(channel, [activeChannel()])
    expect(outcome).toMatchObject({ status: 409 })
    expect((outcome as { body?: { error?: unknown } }).body?.error).toEqual(expect.any(String))
    expect(channel.deletedAt).toBeInstanceOf(Date)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('refuses to restore a mailbox that is connected again for the same provider', async () => {
    const channel = deletedChannel({ providerKey: 'gmail', externalIdentifier: 'owner@example.com' })
    const { em, outcome } = await runUndo(channel, [
      activeChannel({ providerKey: 'gmail', externalIdentifier: 'owner@example.com' }),
    ])
    expect(outcome).toMatchObject({ status: 409 })
    expect(channel.deletedAt).toBeInstanceOf(Date)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('refuses to restore a mailbox that is now connected through another provider', async () => {
    const channel = deletedChannel({ providerKey: 'gmail', externalIdentifier: 'owner@example.com' })
    const { outcome } = await runUndo(channel, [
      activeChannel({ providerKey: 'imap', externalIdentifier: 'Owner@Example.com' }),
    ])
    expect(outcome).toMatchObject({ status: 409 })
    expect(channel.deletedAt).toBeInstanceOf(Date)
  })

  it('refuses to restore an identifier-less channel once the provider reported an identifier', async () => {
    const channel = deletedChannel()
    const { outcome } = await runUndo(channel, [activeChannel({ externalIdentifier: 'bot-1234' })])
    expect(outcome).toMatchObject({ status: 409 })
    expect(channel.deletedAt).toBeInstanceOf(Date)
  })

  it('refuses to restore an identified channel next to an identifier-less row of the same provider', async () => {
    const channel = deletedChannel({ externalIdentifier: 'bot-1234' })
    const { outcome } = await runUndo(channel, [activeChannel()])
    expect(outcome).toMatchObject({ status: 409 })
    expect(channel.deletedAt).toBeInstanceOf(Date)
  })

  it('restores an identifier-less channel next to the same provider in another organization', async () => {
    const channel = deletedChannel({ organizationId: ORG })
    const { outcome } = await runUndo(channel, [
      activeChannel({ organizationId: '66666666-6666-4666-8666-666666666666' }),
    ])
    expect(outcome).toBeNull()
    expect(channel.deletedAt).toBeNull()
  })

  it('restores an identifier-less channel next to a row of the same provider that predates the delete', async () => {
    const channel = deletedChannel()
    const { outcome } = await runUndo(channel, [
      activeChannel({
        createdAt: new Date('2026-01-15T00:00:00Z'),
        isActive: false,
        status: 'disconnected',
        lastError: 'superseded_by_reconnect',
      }),
    ])
    expect(outcome).toBeNull()
    expect(channel.deletedAt).toBeNull()
  })

  it('restores a chat handle next to one that differs only in case', async () => {
    const channel = deletedChannel({ externalIdentifier: 'Bot-Handle' })
    const { outcome } = await runUndo(channel, [activeChannel({ externalIdentifier: 'bot-handle' })])
    expect(outcome).toBeNull()
    expect(channel.deletedAt).toBeNull()
  })

  it('still restores the channel next to unrelated active channels', async () => {
    const channel = deletedChannel({ providerKey: 'gmail', externalIdentifier: 'owner@example.com' })
    const { em, outcome } = await runUndo(channel, [
      activeChannel({ providerKey: 'gmail', externalIdentifier: 'second@example.com' }),
      activeChannel({ providerKey: 'imap', externalIdentifier: null }),
      activeChannel({ providerKey: 'discord', externalIdentifier: null }),
    ])
    expect(outcome).toBeNull()
    expect(channel.deletedAt).toBeNull()
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('only looks for duplicates among the active channels of the same tenant and owner', async () => {
    const channel = deletedChannel()
    const { em } = await runUndo(channel, [])
    expect(em.find).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: validInput.scope.tenantId,
        userId: validInput.userId,
        deletedAt: null,
        id: { $ne: validInput.channelId },
      }),
      undefined,
    )
    expect(channel.deletedAt).toBeNull()
  })
})

describe('extractUndoPayload', () => {
  it('returns null on non-snapshot values', () => {
    expect(extractUndoPayload(null)).toBeNull()
    expect(extractUndoPayload(undefined)).toBeNull()
    expect(extractUndoPayload(42)).toBeNull()
    expect(extractUndoPayload({ unrelated: true })).toBeNull()
  })

  it('parses the nested .undo shape from a command result', () => {
    expect(
      extractUndoPayload({ status: 'deleted', channelId: 'unused', undo: { channelId: 'ch-7', tenantId: 't-1' } }),
    ).toEqual({ channelId: 'ch-7', tenantId: 't-1' })
  })
})
