import { asFunction, asValue, createContainer } from 'awilix'
import handler, { metadata } from '../channel-requires-reauth-notification'

const mockCreate = jest.fn()
const mockCreateForFeature = jest.fn()

function makeCtx(channel: unknown, notificationsEnabled = true) {
  const findOne = jest.fn().mockResolvedValue(channel)
  const container = createContainer()
  container.register('em', asValue({ fork: () => ({ findOne }) }))
  if (notificationsEnabled) {
    container.register('notificationService', asValue({ create: mockCreate, createForFeature: mockCreateForFeature }))
  }
  return { ctx: { resolve: container.resolve.bind(container) }, container, findOne }
}

beforeEach(() => {
  mockCreate.mockReset()
  mockCreateForFeature.mockReset()
})

describe('channel-requires-reauth-notification metadata', () => {
  it('subscribes to the requires_reauth event with a stable id', () => {
    expect(metadata.event).toBe('communication_channels.channel.requires_reauth')
    expect(metadata.persistent).toBe(true)
    expect(metadata.id).toBe('communication_channels:channel-requires-reauth-notification')
  })
})

describe('channel-requires-reauth-notification behaviour', () => {
  it('skips the channel lookup when notifications is disabled', async () => {
    const { ctx, findOne } = makeCtx({ id: 'ch1', userId: 'user-9' }, false)
    await handler({ channelId: 'ch1', tenantId: 't1' }, ctx)
    expect(findOne).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockCreateForFeature).not.toHaveBeenCalled()
  })

  it('propagates a registered notification service initialization failure', async () => {
    const { ctx, container } = makeCtx(null)
    const failure = new Error('notification service initialization failed')
    container.register('notificationService', asFunction(() => { throw failure }))
    await expect(handler({ channelId: 'ch1', tenantId: 't1' }, ctx)).rejects.toBe(failure)
  })

  it('no-ops when channelId is missing', async () => {
    const { ctx, findOne } = makeCtx(null)
    await handler({ tenantId: 't1' } as never, ctx)
    expect(findOne).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockCreateForFeature).not.toHaveBeenCalled()
  })

  it('no-ops (fail-closed) when tenantId is missing', async () => {
    const { ctx, findOne } = makeCtx(null)
    await handler({ channelId: 'ch1' } as never, ctx)
    expect(findOne).not.toHaveBeenCalled()
  })

  it('no-ops when the channel no longer exists', async () => {
    const { ctx } = makeCtx(null)
    await handler({ channelId: 'ch1', tenantId: 't1', organizationId: 'o1' }, ctx)
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockCreateForFeature).not.toHaveBeenCalled()
  })

  it('notifies the channel owner for a per-user channel (deduped by channelId)', async () => {
    const { ctx } = makeCtx({ id: 'ch1', userId: 'user-9' })
    await handler({ channelId: 'ch1', tenantId: 't1', organizationId: 'o1' }, ctx)
    expect(mockCreateForFeature).not.toHaveBeenCalled()
    expect(mockCreate).toHaveBeenCalledTimes(1)
    const [input, scopeArg] = mockCreate.mock.calls[0]
    expect(input.recipientUserId).toBe('user-9')
    expect(input.type).toBe('communication_channels.channel.requires_reauth')
    expect(input.sourceEntityId).toBe('ch1')
    expect(input.groupKey).toBe('ch1')
    expect(scopeArg).toEqual({ tenantId: 't1', organizationId: 'o1' })
  })

  it('notifies managers for a tenant-wide channel without an owner', async () => {
    const { container } = makeCtx({ id: 'ch2', userId: null })
    await handler({ channelId: 'ch2', tenantId: 't1', organizationId: null }, { container })
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockCreateForFeature).toHaveBeenCalledTimes(1)
    const [input] = mockCreateForFeature.mock.calls[0]
    expect(input.requiredFeature).toBe('communication_channels.manage')
    expect(input.type).toBe('communication_channels.channel.requires_reauth')
    expect(input.groupKey).toBe('ch2')
  })
})
