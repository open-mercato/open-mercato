jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  resolveChannelThreadAccess,
  resolveChannelThreadAccessSafely,
} from '../channel-thread-access'

const mockFind = jest.mocked(findWithDecryption)

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }
const OPERATOR = { userId: 'operator-1', features: ['messages.compose'] }

function makeContainer() {
  const em: any = { fork: () => em }
  return { resolve: (name: string) => (name === 'em' ? em : null) } as any
}

const MAPPING = {
  messageThreadId: 'thread-1',
  externalConversationId: 'conv-1',
  channelId: 'ch-1',
}

const SHARED_CHANNEL = { id: 'ch-1', channelType: 'email', userId: null }
const PERSONAL_CHANNEL = { id: 'ch-2', channelType: 'email', userId: OPERATOR.userId }
const PERSONAL_MAPPING = { ...MAPPING, externalConversationId: 'conv-2', channelId: PERSONAL_CHANNEL.id }

describe('resolveChannelThreadAccess (#5535)', () => {
  beforeEach(() => mockFind.mockReset())

  it('grants access to a shared channel thread for any feature-gated caller', async () => {
    mockFind
      .mockResolvedValueOnce([MAPPING])
      .mockResolvedValueOnce([{ ...SHARED_CHANNEL, channelType: 'discord' }])

    const result = await resolveChannelThreadAccess(
      makeContainer(),
      SCOPE,
      { messageThreadId: 'thread-1' },
      OPERATOR,
    )

    expect(result).toEqual({
      messageThreadId: 'thread-1',
      externalConversationId: 'conv-1',
      channelId: 'ch-1',
      channelType: 'discord',
      canAccess: true,
    })
  })

  it('keeps a personal mailbox owner-only', async () => {
    mockFind
      .mockResolvedValueOnce([MAPPING])
      .mockResolvedValueOnce([{ ...SHARED_CHANNEL, userId: 'someone-else' }])

    const result = await resolveChannelThreadAccess(
      makeContainer(),
      SCOPE,
      { messageThreadId: 'thread-1' },
      OPERATOR,
    )

    expect(result?.canAccess).toBe(false)
  })

  it('grants the owner access to their own personal mailbox thread', async () => {
    mockFind
      .mockResolvedValueOnce([PERSONAL_MAPPING])
      .mockResolvedValueOnce([PERSONAL_CHANNEL])

    const result = await resolveChannelThreadAccess(
      makeContainer(),
      SCOPE,
      { messageThreadId: 'thread-1' },
      OPERATOR,
    )

    expect(result?.canAccess).toBe(true)
  })

  it.each([
    { order: 'shared first', mappings: [MAPPING, PERSONAL_MAPPING] },
    { order: 'personal first', mappings: [PERSONAL_MAPPING, MAPPING] },
  ])('requires access to every channel with $order', async ({ mappings }) => {
    mockFind
      .mockResolvedValueOnce(mappings)
      .mockResolvedValueOnce([PERSONAL_CHANNEL, SHARED_CHANNEL])
      .mockResolvedValueOnce(mappings)
      .mockResolvedValueOnce([SHARED_CHANNEL, PERSONAL_CHANNEL])

    const reference = { messageThreadId: MAPPING.messageThreadId }
    const teammate = { ...OPERATOR, userId: 'teammate', features: ['*'] }
    const denied = await resolveChannelThreadAccess(makeContainer(), SCOPE, reference, teammate)
    const granted = await resolveChannelThreadAccess(makeContainer(), SCOPE, reference, OPERATOR)

    expect(denied?.canAccess).toBe(false)
    expect(granted).toMatchObject({ channelId: mappings[0].channelId, canAccess: true })
    expect(mockFind.mock.calls[0][3]).toEqual({ orderBy: { createdAt: 'ASC', id: 'ASC' } })
  })

  it('denies thread access when one mapped channel cannot be resolved in scope', async () => {
    mockFind.mockResolvedValueOnce([PERSONAL_MAPPING, MAPPING]).mockResolvedValueOnce([SHARED_CHANNEL])

    const result = await resolveChannelThreadAccess(
      makeContainer(), SCOPE, { messageThreadId: MAPPING.messageThreadId }, OPERATOR,
    )

    expect(result).toMatchObject({ channelId: SHARED_CHANNEL.id, canAccess: false })
  })

  it('resolves the thread of an external conversation', async () => {
    mockFind.mockResolvedValueOnce([MAPPING]).mockResolvedValueOnce([SHARED_CHANNEL])

    const result = await resolveChannelThreadAccess(
      makeContainer(),
      SCOPE,
      { externalConversationId: 'conv-1' },
      OPERATOR,
    )

    expect(result?.messageThreadId).toBe('thread-1')
    expect(mockFind.mock.calls[0][2]).toMatchObject({ externalConversationId: 'conv-1' })
  })

  it('reports an internal thread as not channel-linked', async () => {
    mockFind.mockResolvedValue([])

    expect(
      await resolveChannelThreadAccess(makeContainer(), SCOPE, { messageThreadId: 'thread-1' }, OPERATOR),
    ).toBeNull()
    expect(await resolveChannelThreadAccess(makeContainer(), SCOPE, {}, OPERATOR)).toBeNull()
  })

  it('scopes every lookup to the caller tenant and organization', async () => {
    mockFind.mockResolvedValueOnce([MAPPING, PERSONAL_MAPPING]).mockResolvedValueOnce([SHARED_CHANNEL, PERSONAL_CHANNEL])

    await resolveChannelThreadAccess(makeContainer(), SCOPE, { messageThreadId: 'thread-1' }, OPERATOR)

    expect(mockFind.mock.calls[0][2]).toEqual({ messageThreadId: MAPPING.messageThreadId, ...SCOPE })
    expect(mockFind.mock.calls[1][2]).toEqual({
      id: { $in: [SHARED_CHANNEL.id, PERSONAL_CHANNEL.id] },
      tenantId: SCOPE.tenantId,
      $or: [{ organizationId: SCOPE.organizationId }, { organizationId: null }],
      deletedAt: null,
    })
    expect(mockFind.mock.calls.map((call) => call[4])).toEqual([SCOPE, SCOPE])
  })

  it('degrades to "internal thread" instead of throwing when a lookup fails', async () => {
    mockFind.mockRejectedValue(new Error('connection terminated'))

    await expect(
      resolveChannelThreadAccessSafely(
        makeContainer(),
        SCOPE,
        { messageThreadId: 'thread-1' },
        OPERATOR,
      ),
    ).resolves.toBeNull()
  })
})
