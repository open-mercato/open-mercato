import adminDeleteChannelCommand, {
  COMMUNICATION_CHANNELS_ADMIN_DELETE_CHANNEL_COMMAND_ID,
  extractUndoPayload,
} from '../admin-delete-channel'

// Push teardown is a best-effort side effect gated on a credentialsRef; stub it
// so these tests stay focused on the soft-delete + undo behavior.
jest.mock('../push-unregister', () => ({
  pushUnregister: jest.fn(async () => undefined),
}))
import { pushUnregister } from '../push-unregister'
const pushUnregisterMock = pushUnregister as unknown as jest.Mock

// UUID v4 format (version nibble = 4, variant nibble = 8|9|a|b) — zod v4 enforces it.
const validInput = {
  channelId: '11111111-1111-4111-8111-111111111111',
  scope: { tenantId: '33333333-3333-4333-8333-333333333333', organizationId: null as string | null },
}

describe('adminDeleteChannelCommand metadata', () => {
  it('exports the canonical command id', () => {
    expect(COMMUNICATION_CHANNELS_ADMIN_DELETE_CHANNEL_COMMAND_ID).toBe(
      'communication_channels.channel.admin_delete',
    )
    expect(adminDeleteChannelCommand.id).toBe(COMMUNICATION_CHANNELS_ADMIN_DELETE_CHANNEL_COMMAND_ID)
  })
})

describe('adminDeleteChannelCommand input validation', () => {
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
      adminDeleteChannelCommand.execute(
        { channelId: 'not-a-uuid', scope: validInput.scope } as never,
        emptyCtx(),
      ),
    ).rejects.toThrow()
  })
})

describe('adminDeleteChannelCommand behaviour', () => {
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
    expect(await adminDeleteChannelCommand.execute(validInput, ctx)).toMatchObject({ status: 'noop' })
  })

  it('returns not_tenant_wide when channel.userId is set (per-user channel)', async () => {
    const { ctx, em } = makeCtxWithChannel({
      id: validInput.channelId,
      userId: '22222222-2222-4222-8222-222222222222',
      tenantId: validInput.scope.tenantId,
      deletedAt: null,
    })
    expect(await adminDeleteChannelCommand.execute(validInput, ctx)).toMatchObject({
      status: 'not_tenant_wide',
    })
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('soft-deletes a tenant-wide (userId=null) channel, clears isPrimary, and returns an undo snapshot', async () => {
    const channel = {
      id: validInput.channelId,
      userId: null as string | null,
      tenantId: validInput.scope.tenantId,
      organizationId: null as string | null,
      credentialsRef: null as string | null,
      providerKey: 'fcm',
      channelType: 'push',
      isPrimary: true,
      deletedAt: null as Date | null,
    }
    const { ctx, em } = makeCtxWithChannel(channel)
    const result = await adminDeleteChannelCommand.execute(validInput, ctx)
    expect(result).toMatchObject({
      status: 'deleted',
      channelId: channel.id,
      undo: { channelId: channel.id, tenantId: validInput.scope.tenantId },
    })
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(channel.deletedAt).toBeInstanceOf(Date)
    expect(channel.isPrimary).toBe(false)
    // No credentialsRef → push teardown skipped.
    expect(pushUnregisterMock).not.toHaveBeenCalled()
  })

  it('tears down push delivery (best-effort) when the channel has a credentialsRef', async () => {
    const channel = {
      id: validInput.channelId,
      userId: null as string | null,
      tenantId: validInput.scope.tenantId,
      organizationId: null as string | null,
      credentialsRef: 'cred-1',
      providerKey: 'fcm',
      channelType: 'push',
      isPrimary: false,
      deletedAt: null as Date | null,
    }
    const { ctx } = makeCtxWithChannel(channel)
    await adminDeleteChannelCommand.execute(validInput, ctx)
    expect(pushUnregisterMock).toHaveBeenCalledTimes(1)
    // Keyed on the channel's own org (`?? tenantId` when NULL).
    expect(pushUnregisterMock.mock.calls[0][0]).toMatchObject({
      scope: {
        tenantId: validInput.scope.tenantId,
        organizationId: validInput.scope.tenantId,
      },
      input: { channelId: channel.id },
    })
  })

  it('undo() clears deletedAt to restore the row', async () => {
    const channel = { id: validInput.channelId, deletedAt: new Date() as Date | null, isPrimary: false }
    const em = { findOne: jest.fn(async () => channel), flush: jest.fn(async () => undefined) }
    const ctx = {
      container: { resolve: ((name: string) => (name === 'em' ? { fork: () => em } : null)) as <T>(name: string) => T },
    } as never
    await adminDeleteChannelCommand.undo!({
      input: { channelId: validInput.channelId } as never,
      ctx,
      logEntry: {
        commandPayload: { undo: { channelId: validInput.channelId, tenantId: validInput.scope.tenantId } },
      } as never,
    })
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(channel.deletedAt).toBeNull()
  })

  it('buildLog persists the undo snapshot under payload.undo for a deleted result', async () => {
    const undoSnapshot = { channelId: validInput.channelId, tenantId: validInput.scope.tenantId }
    const meta = await adminDeleteChannelCommand.buildLog!({
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

  it('buildLog returns null when there is nothing to undo (noop/not_tenant_wide)', async () => {
    expect(
      await adminDeleteChannelCommand.buildLog!({
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
