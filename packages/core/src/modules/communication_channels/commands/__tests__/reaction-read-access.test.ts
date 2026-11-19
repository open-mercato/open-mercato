const mockFindOne = jest.fn()
const mockFindMany = jest.fn()
const mockEnqueue = jest.fn()
const mockEmit = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOne(...args),
  findWithDecryption: (...args: unknown[]) => mockFindMany(...args),
}))
jest.mock('../../lib/queue', () => ({
  COMMUNICATION_CHANNELS_QUEUES: { reactions: 'reactions' },
  getCommunicationChannelsQueue: () => ({ enqueue: mockEnqueue }),
}))
jest.mock('../../events', () => ({
  emitCommunicationChannelsEvent: (...args: unknown[]) => mockEmit(...args),
}))

import { Message, MessageRecipient } from '@open-mercato/core/modules/messages/data/entities'
import { ChannelThreadMapping, CommunicationChannel, MessageChannelLink, MessageReaction } from '../../data/entities'
import command from '../toggle-outbound-reaction'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const messageId = '44444444-4444-4444-8444-444444444444'
const reactionId = '55555555-5555-4555-8555-555555555555'

function setup(options: {
  sender?: boolean
  recipient?: boolean
  visibility?: string | null
  channelSource?: boolean
  linked?: boolean
  channelOwner?: string | null
  canView?: boolean
  missingRbac?: boolean
  rbacFailure?: boolean
  missingMessage?: boolean
} = {}) {
  const em = {
    create: jest.fn(() => ({ id: reactionId })),
    persist: jest.fn(),
    remove: jest.fn(),
    flush: jest.fn(),
  }
  const canView = jest.fn(async () => {
    if (options.rbacFailure) throw new Error('[internal] RBAC unavailable')
    return options.canView ?? true
  })
  mockFindOne.mockImplementation(async (_em: unknown, entity: unknown) => {
    if (entity === Message) return options.missingMessage ? null : {
      id: messageId,
      threadId: messageId,
      senderUserId: options.sender ? userId : 'other-user',
      visibility: options.visibility === undefined ? 'public' : options.visibility,
      sourceEntityType: options.channelSource === false ? null : 'communication_channels.external_conversation',
    }
    if (entity === MessageRecipient) return options.recipient ? { id: 'recipient' } : null
    if (entity === MessageChannelLink) return options.linked === false ? null : { id: 'link', providerKey: 'slack' }
    if (entity === ChannelThreadMapping) return { channelId: 'channel' }
    if (entity === CommunicationChannel) return {
      id: 'channel',
      userId: options.channelOwner ?? null,
      capabilities: { multiReactionPerUser: true },
    }
    if (entity === MessageReaction) return { id: reactionId, emoji: '👍', reactedByUserId: userId }
    throw new Error('[internal] Unexpected entity')
  })
  mockFindMany.mockResolvedValue([])
  const context = {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return { fork: () => em }
        if (name === 'rbacService' && !options.missingRbac) return { userHasAllFeatures: canView }
        throw new Error('[internal] Service unavailable')
      },
    },
    auth: { sub: userId, tenantId, orgId: organizationId },
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
  } as never
  return {
    em,
    canView,
    execute: (action: 'add' | 'remove') => command.execute({
      messageId,
      reactionId,
      emoji: '👍',
      action,
      reactedByUserId: userId,
      scope: { tenantId, organizationId },
    }, context),
  }
}

describe('reaction message read access (#7671)', () => {
  beforeEach(() => jest.resetAllMocks())

  it.each(['add', 'remove'] as const)('masks an unreadable internal message before %s or channel lookup', async (action) => {
    const fixture = setup({ visibility: 'internal' })
    expect(await fixture.execute(action)).toEqual({ status: 'not_found', reason: 'message not found' })
    expect(mockFindOne.mock.calls.map((call) => call[1])).toEqual([Message, MessageRecipient])
    expect(fixture.em.flush).not.toHaveBeenCalled()
    expect(mockEnqueue).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it.each([null, 'internal'])('does not grant channel readers access to visibility %s', async (visibility) => {
    const fixture = setup({ visibility })
    expect((await fixture.execute('add')).status).toBe('not_found')
    expect(fixture.canView).not.toHaveBeenCalled()
  })

  it('does not grant a public internal message the external-channel fallback', async () => {
    const fixture = setup({ channelSource: false })
    expect((await fixture.execute('add')).status).toBe('not_found')
    expect(fixture.canView).not.toHaveBeenCalled()
  })

  it.each([{ canView: false }, { missingRbac: true }, { rbacFailure: true }])('fails closed when the channel read feature cannot be granted: %p', async (options) => {
    const fixture = setup(options)
    expect((await fixture.execute('add')).status).toBe('not_found')
    expect(fixture.em.flush).not.toHaveBeenCalled()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it.each(['add', 'remove'] as const)('allows %s on a readable public shared channel without a recipient row', async (action) => {
    const fixture = setup()
    expect((await fixture.execute(action)).status).toBe(action === 'add' ? 'added' : 'removed')
    expect(fixture.canView).toHaveBeenCalledWith(userId, ['messages.view'], { tenantId, organizationId })
    expect(mockEnqueue).toHaveBeenCalledTimes(1)
  })

  it.each([{ sender: true }, { recipient: true }])('allows participants without the broad read feature: %p', async (options) => {
    const fixture = setup({ ...options, visibility: 'internal', canView: false })
    expect((await fixture.execute('add')).status).toBe('added')
    expect(fixture.canView).not.toHaveBeenCalled()
  })

  it('keeps an inaccessible personal channel unavailable even for a message participant', async () => {
    const fixture = setup({ sender: true, channelOwner: 'another-user' })
    expect((await fixture.execute('add')).status).toBe('not_owner')
    expect(fixture.em.flush).not.toHaveBeenCalled()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('keeps the no-channel conflict only for a readable message', async () => {
    const fixture = setup({ sender: true, linked: false, channelSource: false })
    expect((await fixture.execute('add')).status).toBe('no_channel_link')
  })

  it('scopes the parent lookup and ignores deleted recipient rows', async () => {
    const fixture = setup({ visibility: 'internal' })
    await fixture.execute('remove')
    expect(mockFindOne).toHaveBeenCalledWith(expect.anything(), Message, {
      id: messageId, tenantId, organizationId, deletedAt: null,
    }, undefined, { tenantId, organizationId })
    expect(mockFindOne).toHaveBeenCalledWith(expect.anything(), MessageRecipient, {
      messageId, recipientUserId: userId, deletedAt: null,
    }, undefined, { tenantId, organizationId })
  })
})
