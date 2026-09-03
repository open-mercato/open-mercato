/**
 * Authorization coverage for `communication_channels.channel.set_visibility`.
 *
 * The owner-only guarantee is the whole point of this command: flipping a channel
 * to `shared` exposes an entire mailbox to the team. The integration specs cover
 * the happy path, but they need a live app plus `OM_ENABLE_TEST_CHANNEL_SEEDING`,
 * so the refusal branches are asserted here where they always run.
 */

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand: jest.fn(),
}))

const findOneWithDecryptionMock = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

const withAtomicFlushMock = jest.fn(async (_em: unknown, phases: Array<() => unknown>) => {
  for (const phase of phases) await phase()
})
jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: (...args: unknown[]) => (withAtomicFlushMock as never)(...(args as never[])),
}))

const emitEventMock = jest.fn()
jest.mock('../../events', () => ({
  emitCommunicationChannelsEvent: (...args: unknown[]) => emitEventMock(...args),
}))

import { setChannelVisibilityCommand } from '../set-channel-visibility'

const TENANT = '22222222-2222-4222-8222-222222222222'
const ORG = '33333333-3333-4333-8333-333333333333'
const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '44444444-4444-4444-8444-444444444444'
const CHANNEL = '55555555-5555-4555-8555-555555555555'

function ctx() {
  return {
    container: { resolve: () => ({ fork: () => ({}) }) } as never,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
    syncOrigin: undefined,
  } as never
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    channelId: CHANNEL,
    userId: OWNER,
    visibility: 'shared',
    scope: { tenantId: TENANT, organizationId: ORG },
    ...overrides,
  } as never
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('set_visibility — ownership', () => {
  it('refuses a channel owned by another user (not_owner, never a partial write)', async () => {
    findOneWithDecryptionMock.mockResolvedValue({
      id: CHANNEL,
      userId: OTHER,
      visibility: 'private',
      updatedAt: new Date(),
    })

    const result = await setChannelVisibilityCommand.execute(input(), ctx())

    expect(result.status).toBe('not_owner')
    // The entire owner-only guarantee: no flush, no event, nothing observable.
    expect(withAtomicFlushMock).not.toHaveBeenCalled()
    expect(emitEventMock).not.toHaveBeenCalled()
  })

  it('refuses a TENANT-SCOPED channel — shared by definition, no owner to consent', async () => {
    findOneWithDecryptionMock.mockResolvedValue({
      id: CHANNEL,
      userId: null,
      visibility: 'shared',
      updatedAt: new Date(),
    })

    const result = await setChannelVisibilityCommand.execute(input(), ctx())

    expect(result.status).toBe('not_owner')
    expect(withAtomicFlushMock).not.toHaveBeenCalled()
  })

  it('reports not_owner for a missing channel, masking row existence', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)

    const result = await setChannelVisibilityCommand.execute(input(), ctx())

    // Deliberately indistinguishable from "someone else's channel" — the route
    // maps both to 404.
    expect(result.status).toBe('not_owner')
  })
})

describe('set_visibility — happy path and idempotency', () => {
  it('flips an owned private channel to shared and emits the audit event', async () => {
    const channel = { id: CHANNEL, userId: OWNER, visibility: 'private', updatedAt: new Date() }
    findOneWithDecryptionMock.mockResolvedValue(channel)

    const result = await setChannelVisibilityCommand.execute(input(), ctx())

    expect(result).toMatchObject({ status: 'set', channelId: CHANNEL, previousVisibility: 'private' })
    expect(channel.visibility).toBe('shared')
    expect(withAtomicFlushMock).toHaveBeenCalledTimes(1)
    expect(emitEventMock).toHaveBeenCalledWith(
      'communication_channels.channel.visibility_changed',
      expect.objectContaining({ previousVisibility: 'private', nextVisibility: 'shared' }),
    )
  })

  it('is a no-op when already at the requested value', async () => {
    findOneWithDecryptionMock.mockResolvedValue({
      id: CHANNEL,
      userId: OWNER,
      visibility: 'shared',
      updatedAt: new Date(),
    })

    const result = await setChannelVisibilityCommand.execute(input({ visibility: 'shared' }), ctx())

    expect(result.status).toBe('noop')
    expect(withAtomicFlushMock).not.toHaveBeenCalled()
  })

  it('does not let a failed audit emission fail a committed flip', async () => {
    findOneWithDecryptionMock.mockResolvedValue({
      id: CHANNEL,
      userId: OWNER,
      visibility: 'private',
      updatedAt: new Date(),
    })
    emitEventMock.mockRejectedValue(new Error('bus down'))

    const result = await setChannelVisibilityCommand.execute(input(), ctx())

    expect(result.status).toBe('set')
  })
})

describe('set_visibility — optimistic locking', () => {
  it('throws 409 when the caller holds a stale version', async () => {
    findOneWithDecryptionMock.mockResolvedValue({
      id: CHANNEL,
      userId: OWNER,
      visibility: 'private',
      updatedAt: new Date('2026-08-25T10:00:00.000Z'),
    })

    await expect(
      setChannelVisibilityCommand.execute(
        input({ expectedUpdatedAt: '2026-08-01T00:00:00.000Z' }),
        ctx(),
      ),
    ).rejects.toMatchObject({ status: 409 })
    expect(withAtomicFlushMock).not.toHaveBeenCalled()
  })

  it('proceeds when no expectation is supplied (strictly additive)', async () => {
    findOneWithDecryptionMock.mockResolvedValue({
      id: CHANNEL,
      userId: OWNER,
      visibility: 'private',
      updatedAt: new Date(),
    })

    const result = await setChannelVisibilityCommand.execute(input(), ctx())

    expect(result.status).toBe('set')
  })
})

describe('set_visibility — schema', () => {
  it('rejects a non-uuid channelId', async () => {
    await expect(
      setChannelVisibilityCommand.execute(input({ channelId: 'nope' }), ctx()),
    ).rejects.toThrow()
  })

  it('rejects a visibility value outside the enum', async () => {
    await expect(
      setChannelVisibilityCommand.execute(input({ visibility: 'public' }), ctx()),
    ).rejects.toThrow()
  })
})
