/**
 * Fail-closed coverage for the share-lookup helpers.
 *
 * Everything these return only ever WIDENS visibility, so every failure mode has
 * to narrow. An api_key principal, a thrown query, or a malformed row must all
 * yield "no grants" rather than propagating or, worse, over-sharing.
 */

import {
  canShareConversation,
  listGrantsForViewer,
  listGrantsForViewerOnPerson,
  listSharedChannelIds,
  SHARED_CHANNEL_ARM_MAX,
} from '../conversationShares'

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }
const PERSON = 'person-1'

function em(overrides: Record<string, unknown> = {}) {
  return {
    find: jest.fn(async () => []),
    findOne: jest.fn(async () => null),
    count: jest.fn(async () => 0),
    ...overrides,
  } as never
}

describe('api-key and anonymous callers never gain grants', () => {
  it.each([
    ['null viewer', null],
    ['api-key principal', 'api_key:abc'],
  ])('listGrantsForViewer returns [] for %s', async (_label, viewer) => {
    const manager = em({ find: jest.fn(async () => [{ id: 'x' }]) })
    await expect(listGrantsForViewer(manager, SCOPE, viewer as never)).resolves.toEqual([])
    // Short-circuits before touching the database at all.
    expect((manager as never as { find: jest.Mock }).find).not.toHaveBeenCalled()
  })

  it.each([
    ['null viewer', null],
    ['api-key principal', 'api_key:abc'],
  ])('listSharedChannelIds returns [] for %s', async (_label, viewer) => {
    const manager = em({ find: jest.fn(async () => [{ id: 'c1', userId: 'someone' }]) })
    await expect(listSharedChannelIds(manager, SCOPE, viewer as never)).resolves.toEqual([])
    expect((manager as never as { find: jest.Mock }).find).not.toHaveBeenCalled()
  })

  it('canShareConversation is false for an api-key principal', async () => {
    const manager = em({ count: jest.fn(async () => 5) })
    await expect(canShareConversation(manager, SCOPE, 'api_key:abc', PERSON)).resolves.toBe(false)
    expect((manager as never as { count: jest.Mock }).count).not.toHaveBeenCalled()
  })
})

describe('malformed and hostile query results fail closed', () => {
  it('listGrantsForViewer skips rows with no person or no owner', async () => {
    const manager = em({
      find: jest.fn(async () => [
        { ownerUserId: 'owner-1', personEntity: { id: 'p1' } },
        { ownerUserId: 'owner-2', personEntity: null },
        { ownerUserId: '', personEntity: { id: 'p3' } },
        null,
      ]),
    })
    await expect(listGrantsForViewer(manager, SCOPE, 'me')).resolves.toEqual([
      { personEntityId: 'p1', ownerUserId: 'owner-1' },
    ])
  })

  it('listGrantsForViewerOnPerson yields [] when the query returns a non-array', async () => {
    const manager = em({ find: jest.fn(async () => undefined) })
    await expect(listGrantsForViewerOnPerson(manager, SCOPE, 'me', PERSON)).resolves.toEqual([])
  })

  it('listSharedChannelIds swallows a thrown query rather than breaking the page', async () => {
    const manager = em({
      find: jest.fn(async () => {
        throw new Error('connection reset')
      }),
    })
    await expect(listSharedChannelIds(manager, SCOPE, 'me')).resolves.toEqual([])
  })
})

describe('listSharedChannelIds scoping', () => {
  it("excludes the caller's own channels — the author arm already admits those rows", async () => {
    const manager = em({
      find: jest.fn(async () => [
        { id: 'mine', userId: 'me' },
        { id: 'theirs', userId: 'other' },
      ]),
    })
    await expect(listSharedChannelIds(manager, SCOPE, 'me')).resolves.toEqual(['theirs'])
  })

  it('caps the returned set at SHARED_CHANNEL_ARM_MAX', async () => {
    const many = Array.from({ length: SHARED_CHANNEL_ARM_MAX + 25 }, (_v, i) => ({
      id: `c${i}`,
      userId: 'other',
    }))
    const manager = em({ find: jest.fn(async () => many) })
    const ids = await listSharedChannelIds(manager, SCOPE, 'me')
    expect(ids).toHaveLength(SHARED_CHANNEL_ARM_MAX)
  })
})

describe('canShareConversation', () => {
  it('is true only when the caller authors a PRIVATE email for the person', async () => {
    const count = jest.fn(async () => 1)
    await expect(canShareConversation(em({ count }), SCOPE, 'owner-1', PERSON)).resolves.toBe(true)
    // A mailbox whose mail is already `shared` has nothing to escalate.
    expect(count).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ visibility: 'private', authorUserId: 'owner-1' }),
    )
  })

  it('is false when the caller authors none', async () => {
    await expect(
      canShareConversation(em({ count: jest.fn(async () => 0) }), SCOPE, 'owner-1', PERSON),
    ).resolves.toBe(false)
  })

  it('is false without a person id', async () => {
    await expect(canShareConversation(em(), SCOPE, 'owner-1', '')).resolves.toBe(false)
  })
})
