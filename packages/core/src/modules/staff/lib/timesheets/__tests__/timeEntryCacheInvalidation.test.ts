/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const recordId = '33333333-3333-4333-8333-333333333333'

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: jest.fn((_tenantId: string | null, fn: () => unknown) => fn()),
}))

const deleteByTags = jest.fn()

const cache = {
  get: jest.fn(),
  set: jest.fn(),
  deleteByTags,
}

const container = {
  resolve: jest.fn((token: string) => {
    if (token === 'cache') return cache
    throw new Error(`[internal] Unexpected container resolve: ${token}`)
  }),
}

const ORIGINAL_ENV = { ...process.env }

const loadHelper = async () => {
  jest.resetModules()
  return import('../timeEntryCacheInvalidation')
}

describe('staff time-entry CRUD cache invalidation (#4970)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...ORIGINAL_ENV }
    deleteByTags.mockResolvedValue(1)
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  it('derives the cache resource from the same create command id the CRUD route registers', async () => {
    const { staffTimeEntryCacheResource, staffTimeEntryCommandIds } = await loadHelper()
    const { canonicalizeResourceTag, deriveResourceFromCommandId } = await import(
      '@open-mercato/shared/lib/crud/cache'
    )

    expect(staffTimeEntryCacheResource).toBe('staff.timesheet')
    expect(staffTimeEntryCacheResource).toBe(
      canonicalizeResourceTag(deriveResourceFromCommandId(staffTimeEntryCommandIds.create)),
    )
  })

  it('does not use the entity-derived tag a hand-written literal would guess', async () => {
    const { staffTimeEntryCacheResource } = await loadHelper()
    const { canonicalizeResourceTag } = await import('@open-mercato/shared/lib/crud/cache')

    expect(staffTimeEntryCacheResource).not.toBe(canonicalizeResourceTag('staff.time_entry'))
    expect(staffTimeEntryCacheResource).not.toBe(canonicalizeResourceTag('StaffTimeEntry'))
  })

  it('flushes the collection and record tags the cached week list is stored under', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const { invalidateStaffTimeEntryCache, staffTimeEntryCacheResource } = await loadHelper()
    const { buildCollectionTags, buildRecordTag } = await import('@open-mercato/shared/lib/crud/cache')

    await invalidateStaffTimeEntryCache(
      container as never,
      { id: recordId, organizationId, tenantId },
      tenantId,
      'bulk:created',
    )

    expect(deleteByTags).toHaveBeenCalledTimes(1)
    const flushedTags = deleteByTags.mock.calls[0][0] as string[]

    expect(flushedTags).toContain(buildRecordTag(staffTimeEntryCacheResource, tenantId, recordId))
    for (const tag of buildCollectionTags(staffTimeEntryCacheResource, tenantId, [null, organizationId])) {
      expect(flushedTags).toContain(tag)
    }
    expect(flushedTags).toContain(
      `crud:staff.timesheet:tenant:${tenantId}:org:${organizationId}:collection`,
    )
  })

  it('swallows a cache-backend failure so an already-committed write still succeeds', async () => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
    const { invalidateStaffTimeEntryCache } = await loadHelper()
    deleteByTags.mockRejectedValue(new Error('[internal] cache backend unavailable'))

    await expect(
      invalidateStaffTimeEntryCache(
        container as never,
        { id: recordId, organizationId, tenantId },
        tenantId,
        'bulk:created',
      ),
    ).resolves.toBeUndefined()

    expect(deleteByTags).toHaveBeenCalledTimes(1)
  })

  it('stays a no-op while the opt-in CRUD list cache is disabled', async () => {
    delete process.env.ENABLE_CRUD_API_CACHE
    const { invalidateStaffTimeEntryCache } = await loadHelper()

    await invalidateStaffTimeEntryCache(
      container as never,
      { id: recordId, organizationId, tenantId },
      tenantId,
      'bulk:created',
    )

    expect(deleteByTags).not.toHaveBeenCalled()
  })
})
