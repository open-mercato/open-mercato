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
    const em = { findOne: jest.fn(async () => channel), flush: jest.fn(async () => undefined) }
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
