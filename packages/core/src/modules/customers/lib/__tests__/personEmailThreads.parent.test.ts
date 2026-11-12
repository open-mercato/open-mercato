jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

import { isMessageOnPersonEmailHistory } from '../personEmailThreads'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerInteraction } from '../../data/entities'

const mockFindWithDecryption = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>

function makeEm(count: number) {
  return { count: jest.fn(async () => count) }
}

const baseOptions = {
  personId: 'person-1',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  viewerUserId: 'viewer-1',
  userFeatures: undefined,
  sharedConversations: [{ personEntityId: 'person-1', ownerUserId: 'owner-1' }],
  sharedChannelIds: ['channel-shared'],
  messageId: 'message-1',
}

describe('isMessageOnPersonEmailHistory', () => {
  beforeEach(() => {
    mockFindWithDecryption.mockReset()
  })

  it('looks the message links up in the Person scope and counts only visible email interactions anchored to them', async () => {
    mockFindWithDecryption.mockResolvedValue([{ id: 'link-1' }, { id: 'link-2' }] as never)
    const em = makeEm(1)

    const visible = await isMessageOnPersonEmailHistory(em as never, baseOptions)

    expect(visible).toBe(true)
    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      em,
      'MessageChannelLink',
      { messageId: 'message-1', tenantId: 'tenant-1', organizationId: 'org-1' },
      undefined,
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
    const [entity, where] = em.count.mock.calls[0] as unknown as [unknown, Record<string, unknown>]
    expect(entity).toBe(CustomerInteraction)
    expect(where).toMatchObject({
      entity: 'person-1',
      interactionType: 'email',
      deletedAt: null,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      externalMessageId: { $in: ['link-1', 'link-2'] },
    })
    expect(where.$or).toEqual([
      { interactionType: { $ne: 'email' } },
      { visibility: null },
      { visibility: { $ne: 'private' } },
      { authorUserId: 'viewer-1' },
      { entity: 'person-1', authorUserId: 'owner-1' },
      { channelId: { $in: ['channel-shared'] } },
    ])
  })

  it('is false when no visible interaction anchors the message to this Person', async () => {
    mockFindWithDecryption.mockResolvedValue([{ id: 'link-1' }] as never)

    expect(await isMessageOnPersonEmailHistory(makeEm(0) as never, baseOptions)).toBe(false)
  })

  it('is false without querying interactions when the message has no channel link in scope', async () => {
    mockFindWithDecryption.mockResolvedValue([] as never)
    const em = makeEm(1)

    expect(await isMessageOnPersonEmailHistory(em as never, baseOptions)).toBe(false)
    expect(em.count).not.toHaveBeenCalled()
  })

  it('never lets a viewer-less caller match the author arm', async () => {
    mockFindWithDecryption.mockResolvedValue([{ id: 'link-1' }] as never)
    const em = makeEm(0)

    await isMessageOnPersonEmailHistory(em as never, {
      ...baseOptions,
      viewerUserId: null,
      sharedConversations: [],
      sharedChannelIds: [],
    })

    const where = em.count.mock.calls[0][1] as unknown as { $or: unknown[] }
    expect(where.$or).toEqual([
      { interactionType: { $ne: 'email' } },
      { visibility: null },
      { visibility: { $ne: 'private' } },
    ])
  })

  it('mirrors the read model when the Person has no organization: tenant-bound, no organization predicate', async () => {
    mockFindWithDecryption.mockResolvedValue([{ id: 'link-1' }] as never)
    const em = makeEm(1)

    await isMessageOnPersonEmailHistory(em as never, { ...baseOptions, organizationId: null })

    expect(mockFindWithDecryption.mock.calls[0][2]).toEqual({ messageId: 'message-1', tenantId: 'tenant-1' })
    const where = em.count.mock.calls[0][1] as unknown as Record<string, unknown>
    expect(where.tenantId).toBe('tenant-1')
    expect(where).not.toHaveProperty('organizationId')
  })
})
