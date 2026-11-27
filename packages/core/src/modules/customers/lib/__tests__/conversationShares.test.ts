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
  loadLiveInteractionAuthority,
  LIVE_INTERACTION_ARM_MAX,
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

describe('loadLiveInteractionAuthority', () => {
  it('returns an empty map without querying when no ids are given', async () => {
    const find = jest.fn(async () => [])
    await expect(loadLiveInteractionAuthority(em({ find }), SCOPE, [])).resolves.toEqual(new Map())
    expect(find).not.toHaveBeenCalled()
  })

  it('dedupes ids and maps the CURRENT visibility/author/channel/parent by id', async () => {
    const find = jest.fn(async () => [
      { id: 'int-1', visibility: 'private', authorUserId: 'owner-1', channelId: 'chan-1', entity: 'person-1' },
      { id: 'int-2', visibility: null, authorUserId: null, channelId: null, entity: null },
    ])
    const result = await loadLiveInteractionAuthority(em({ find }), SCOPE, ['int-1', 'int-1', 'int-2'])
    expect(result).toEqual(
      new Map([
        ['int-1', { visibility: 'private', authorUserId: 'owner-1', channelId: 'chan-1', entityId: 'person-1' }],
        ['int-2', { visibility: null, authorUserId: null, channelId: null, entityId: null }],
      ]),
    )
    expect(find).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: { $in: ['int-1', 'int-2'] }, tenantId: SCOPE.tenantId, deletedAt: null }),
      expect.anything(),
    )
  })

  it('resolves the parent entity id from either a raw FK string or a Reference-shaped object', async () => {
    const find = jest.fn(async () => [
      { id: 'int-1', visibility: 'private', authorUserId: 'owner-1', channelId: null, entity: 'person-raw-fk' },
      { id: 'int-2', visibility: 'private', authorUserId: 'owner-1', channelId: null, entity: { id: 'person-ref' } },
    ])
    const result = await loadLiveInteractionAuthority(em({ find }), SCOPE, ['int-1', 'int-2'])
    expect(result.get('int-1')?.entityId).toBe('person-raw-fk')
    expect(result.get('int-2')?.entityId).toBe('person-ref')
  })

  it('omits a deleted/missing interaction — the caller falls back to its own conservative default', async () => {
    const find = jest.fn(async () => [
      { id: 'int-1', visibility: 'shared', authorUserId: 'owner-1', channelId: null, entity: 'person-1' },
    ])
    const result = await loadLiveInteractionAuthority(em({ find }), SCOPE, ['int-1', 'int-deleted'])
    expect(result.has('int-deleted')).toBe(false)
    expect(result.get('int-1')).toEqual({
      visibility: 'shared',
      authorUserId: 'owner-1',
      channelId: null,
      entityId: 'person-1',
    })
  })

  it('fails closed to an empty map when the lookup throws', async () => {
    const find = jest.fn(async () => {
      throw new Error('connection reset')
    })
    await expect(loadLiveInteractionAuthority(em({ find }), SCOPE, ['int-1'])).resolves.toEqual(new Map())
  })

  // Regression for @pkarw's review on #8978 (pullrequestreview-5909684050) —
  // the batch query MUST always scope by tenantId, and by organizationId
  // whenever the caller's scope carries one, so a row from a different
  // tenant/organization can never surface through this lookup.
  it('always scopes the query by tenantId, and by organizationId when the caller scope carries one', async () => {
    const find = jest.fn(async () => [])
    await loadLiveInteractionAuthority(em({ find }), SCOPE, ['int-1'])
    expect(find).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId }),
      expect.anything(),
    )
  })

  it('omits organizationId from the query when the caller scope has none (tenant-wide read)', async () => {
    const find = jest.fn(async () => [])
    await loadLiveInteractionAuthority(em({ find }), { tenantId: 'tenant-1', organizationId: null }, ['int-1'])
    const [, where] = find.mock.calls[0]
    expect(where).not.toHaveProperty('organizationId')
    expect(where).toMatchObject({ tenantId: 'tenant-1' })
  })

  it.each([499, 500, 501, 1001])('resolves every requested interaction across bounded batches (%s rows)', async (count) => {
    const rows = Array.from({ length: count }, (_value, index) => ({
      id: `int-${index}`,
      visibility: 'shared',
      authorUserId: 'owner-1',
      channelId: null,
    }))
    const find = jest.fn(async (_entity: unknown, where: { id: { $in: string[] } }) =>
      rows.filter((row) => where.id.$in.includes(row.id)),
    )
    const result = await loadLiveInteractionAuthority(em({ find }), SCOPE, rows.map((row) => row.id))
    expect([...result.keys()]).toEqual(rows.map((row) => row.id))
    expect(result.get(`int-${count - 1}`)?.visibility).toBe('shared')
    expect(find).toHaveBeenCalledTimes(Math.ceil(count / LIVE_INTERACTION_ARM_MAX))
    for (const [, where] of find.mock.calls) {
      expect(where.id.$in.length).toBeLessThanOrEqual(LIVE_INTERACTION_ARM_MAX)
      expect(where).toMatchObject({ tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId, deletedAt: null })
    }
  })

  it('fails closed for every batch when a later batch lookup fails', async () => {
    const ids = Array.from({ length: 501 }, (_value, index) => `int-${index}`)
    const find = jest.fn()
      .mockResolvedValueOnce([{ id: ids[0], visibility: 'shared', authorUserId: 'owner-1' }])
      .mockRejectedValueOnce(new Error('[internal] authority lookup failed'))
    await expect(loadLiveInteractionAuthority(em({ find }), SCOPE, ids)).resolves.toEqual(new Map())
    expect(find).toHaveBeenCalledTimes(2)
  })
})
