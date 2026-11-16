jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  resolveChannelThreadAccess,
  resolveChannelThreadAccessSafely,
} from '../channel-thread-access'

const mockFindOne = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>

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

describe('resolveChannelThreadAccess (#5535)', () => {
  beforeEach(() => mockFindOne.mockReset())

  it('grants access to a shared channel thread for any feature-gated caller', async () => {
    mockFindOne
      .mockResolvedValueOnce(MAPPING as never)
      .mockResolvedValueOnce({ id: 'ch-1', channelType: 'discord', userId: null } as never)

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
    mockFindOne
      .mockResolvedValueOnce(MAPPING as never)
      .mockResolvedValueOnce({ id: 'ch-1', channelType: 'email', userId: 'someone-else' } as never)

    const result = await resolveChannelThreadAccess(
      makeContainer(),
      SCOPE,
      { messageThreadId: 'thread-1' },
      OPERATOR,
    )

    expect(result?.canAccess).toBe(false)
  })

  it('grants the owner access to their own personal mailbox thread', async () => {
    mockFindOne
      .mockResolvedValueOnce(MAPPING as never)
      .mockResolvedValueOnce({ id: 'ch-1', channelType: 'email', userId: 'operator-1' } as never)

    const result = await resolveChannelThreadAccess(
      makeContainer(),
      SCOPE,
      { messageThreadId: 'thread-1' },
      OPERATOR,
    )

    expect(result?.canAccess).toBe(true)
  })

  it('resolves the thread of an external conversation', async () => {
    mockFindOne
      .mockResolvedValueOnce(MAPPING as never)
      .mockResolvedValueOnce({ id: 'ch-1', channelType: 'discord', userId: null } as never)

    const result = await resolveChannelThreadAccess(
      makeContainer(),
      SCOPE,
      { externalConversationId: 'conv-1' },
      OPERATOR,
    )

    expect(result?.messageThreadId).toBe('thread-1')
    expect(mockFindOne.mock.calls[0][2]).toMatchObject({ externalConversationId: 'conv-1' })
  })

  it('reports an internal thread as not channel-linked', async () => {
    mockFindOne.mockResolvedValue(null as never)

    expect(
      await resolveChannelThreadAccess(makeContainer(), SCOPE, { messageThreadId: 'thread-1' }, OPERATOR),
    ).toBeNull()
    expect(await resolveChannelThreadAccess(makeContainer(), SCOPE, {}, OPERATOR)).toBeNull()
  })

  it('scopes every lookup to the caller tenant and organization', async () => {
    mockFindOne
      .mockResolvedValueOnce(MAPPING as never)
      .mockResolvedValueOnce({ id: 'ch-1', channelType: 'discord', userId: null } as never)

    await resolveChannelThreadAccess(makeContainer(), SCOPE, { messageThreadId: 'thread-1' }, OPERATOR)

    for (const call of mockFindOne.mock.calls) {
      expect(call[2]).toMatchObject({ tenantId: 'tenant-1' })
      expect(call[4]).toMatchObject({ tenantId: 'tenant-1', organizationId: 'org-1' })
    }
  })

  it('degrades to "internal thread" instead of throwing when a lookup fails', async () => {
    mockFindOne.mockRejectedValue(new Error('connection terminated') as never)

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
