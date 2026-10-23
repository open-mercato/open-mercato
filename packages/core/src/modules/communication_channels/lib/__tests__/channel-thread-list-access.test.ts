jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  CHANNEL_THREAD_LIST_LIMIT,
  listAccessibleChannelThreadIds,
} from '../channel-thread-access'

const mockFindWith = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }
const OPERATOR = { userId: 'operator-1', features: ['messages.view'] }

function makeContainer() {
  const em: any = { fork: () => em }
  return { resolve: (name: string) => (name === 'em' ? em : null) } as any
}

describe('listAccessibleChannelThreadIds (#6106)', () => {
  beforeEach(() => mockFindWith.mockReset())

  it('returns only the threads on channels the actor may act on', async () => {
    mockFindWith
      .mockResolvedValueOnce([
        { messageThreadId: 'thread-shared', channelId: 'ch-shared' },
        { messageThreadId: 'thread-theirs', channelId: 'ch-personal' },
      ] as never)
      .mockResolvedValueOnce([
        { id: 'ch-shared', channelType: 'discord', userId: null },
        { id: 'ch-personal', channelType: 'email', userId: 'someone-else' },
      ] as never)

    const ids = await listAccessibleChannelThreadIds(makeContainer(), SCOPE, OPERATOR)

    expect(ids).toEqual(['thread-shared'])
  })

  it('scopes both lookups to the caller tenant and organization', async () => {
    mockFindWith.mockResolvedValueOnce([] as never)

    await listAccessibleChannelThreadIds(makeContainer(), SCOPE, OPERATOR)

    expect(mockFindWith.mock.calls[0][2]).toMatchObject({ tenantId: 'tenant-1', organizationId: 'org-1' })
  })

  it('returns an empty list when the tenant has no channel threads', async () => {
    mockFindWith.mockResolvedValueOnce([] as never)

    await expect(listAccessibleChannelThreadIds(makeContainer(), SCOPE, OPERATOR)).resolves.toEqual([])
    expect(mockFindWith).toHaveBeenCalledTimes(1)
  })

  it('fails closed with null when the tenant exceeds the list limit', async () => {
    const overflow = Array.from({ length: CHANNEL_THREAD_LIST_LIMIT + 1 }, (_, index) => ({
      messageThreadId: `thread-${index}`,
      channelId: 'ch-shared',
    }))
    mockFindWith.mockResolvedValueOnce(overflow as never)

    await expect(listAccessibleChannelThreadIds(makeContainer(), SCOPE, OPERATOR)).resolves.toBeNull()
    expect(mockFindWith).toHaveBeenCalledTimes(1)
  })
})
