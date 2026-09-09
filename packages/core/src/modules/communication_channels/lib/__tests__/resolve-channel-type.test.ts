jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveChannelType, resolveChannelTypeSafely } from '../resolve-channel-type'

const mockFindOne = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }

function makeContainer() {
  const em: any = { fork: () => em }
  return { resolve: (name: string) => (name === 'em' ? em : null) } as any
}

describe('resolveChannelType (#4975)', () => {
  beforeEach(() => mockFindOne.mockReset())

  it('walks conversation → channel to read the authoritative channel type', async () => {
    mockFindOne
      .mockResolvedValueOnce({ id: 'conv-1', channelId: 'ch-1' } as never)
      .mockResolvedValueOnce({ id: 'ch-1', channelType: 'discord' } as never)

    const result = await resolveChannelType(makeContainer(), SCOPE, {
      externalConversationId: 'conv-1',
    })

    expect(result).toBe('discord')
  })

  it('prefers the denormalized type on the message link when resolving by message', async () => {
    mockFindOne.mockResolvedValueOnce({ messageId: 'msg-1', channelType: 'discord' } as never)

    const result = await resolveChannelType(makeContainer(), SCOPE, { messageId: 'msg-1' })

    expect(result).toBe('discord')
    // The link already carries the type — no conversation/channel hops needed.
    expect(mockFindOne).toHaveBeenCalledTimes(1)
  })

  it('falls back to the link conversation when the link carries no type', async () => {
    mockFindOne
      .mockResolvedValueOnce({ messageId: 'msg-1', externalConversationId: 'conv-1' } as never)
      .mockResolvedValueOnce({ id: 'conv-1', channelId: 'ch-1' } as never)
      .mockResolvedValueOnce({ id: 'ch-1', channelType: 'slack' } as never)

    const result = await resolveChannelType(makeContainer(), SCOPE, { messageId: 'msg-1' })

    expect(result).toBe('slack')
  })

  it('scopes every lookup to the caller tenant and organization', async () => {
    mockFindOne
      .mockResolvedValueOnce({ id: 'conv-1', channelId: 'ch-1' } as never)
      .mockResolvedValueOnce({ id: 'ch-1', channelType: 'discord' } as never)

    await resolveChannelType(makeContainer(), SCOPE, { externalConversationId: 'conv-1' })

    for (const call of mockFindOne.mock.calls) {
      expect(call[2]).toMatchObject({ tenantId: 'tenant-1', organizationId: 'org-1' })
    }
  })

  it('reports unknown for a reference that resolves to nothing', async () => {
    mockFindOne.mockResolvedValue(null as never)

    expect(
      await resolveChannelType(makeContainer(), SCOPE, { externalConversationId: 'conv-1' }),
    ).toBeNull()
    expect(await resolveChannelType(makeContainer(), SCOPE, {})).toBeNull()
  })

  it('reports unknown instead of throwing when a lookup fails', async () => {
    mockFindOne.mockRejectedValue(new Error('connection terminated') as never)

    await expect(
      resolveChannelTypeSafely(makeContainer(), SCOPE, { externalConversationId: 'conv-1' }),
    ).resolves.toBeNull()
  })
})
