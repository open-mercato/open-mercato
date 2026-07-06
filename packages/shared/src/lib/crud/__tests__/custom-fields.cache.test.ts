import { loadCustomFieldDefinitionIndex } from '@open-mercato/shared/lib/crud/custom-fields'

function buildFakeEm(rows: any[]) {
  const find = jest.fn(async () => rows.slice())
  const em = {
    find,
  }
  return { em, find }
}

function buildMemoryCache() {
  const store = new Map<string, { value: unknown; tags: string[]; expiresAt: number | null }>()
  return {
    store,
    get: jest.fn(async (key: string) => {
      const hit = store.get(key)
      if (!hit) return null
      if (hit.expiresAt !== null && hit.expiresAt < Date.now()) {
        store.delete(key)
        return null
      }
      return hit.value
    }),
    set: jest.fn(async (key: string, value: unknown, opts?: { ttl?: number; tags?: string[] }) => {
      const expiresAt = opts?.ttl && opts.ttl > 0 ? Date.now() + opts.ttl : null
      store.set(key, { value, tags: opts?.tags ?? [], expiresAt })
    }),
    deleteByTags: jest.fn(async (tags: string[]) => {
      let removed = 0
      for (const [key, entry] of store.entries()) {
        if (entry.tags.some((tag) => tags.includes(tag))) {
          store.delete(key)
          removed += 1
        }
      }
      return removed
    }),
  }
}

const tenantId = 'tenant-1'
const entityId = 'example.todo'

function fakeDef(key: string, idSuffix: string) {
  return {
    id: `00000000-0000-4000-8000-${idSuffix}`,
    key,
    entityId,
    kind: 'text',
    organizationId: null,
    tenantId,
    updatedAt: new Date('2026-05-24T10:00:00.000Z'),
    configJson: { label: key },
    isActive: true,
  }
}

describe('loadCustomFieldDefinitionIndex caching', () => {
  const originalTtl = process.env.OM_CF_DEF_CACHE_TTL_MS

  afterEach(() => {
    if (originalTtl === undefined) delete process.env.OM_CF_DEF_CACHE_TTL_MS
    else process.env.OM_CF_DEF_CACHE_TTL_MS = originalTtl
  })

  it('hits the underlying em.find once per (tenant, entities) within the TTL window', async () => {
    process.env.OM_CF_DEF_CACHE_TTL_MS = '300000'
    const { em, find } = buildFakeEm([fakeDef('priority', '000000000001')])
    const cache = buildMemoryCache()

    await loadCustomFieldDefinitionIndex({
      em: em as any,
      entityIds: entityId,
      tenantId,
      cache,
    })
    expect(find).toHaveBeenCalledTimes(1)

    await loadCustomFieldDefinitionIndex({
      em: em as any,
      entityIds: entityId,
      tenantId,
      cache,
    })
    expect(find).toHaveBeenCalledTimes(1)
  })

  it('falls through to em.find when OM_CF_DEF_CACHE_TTL_MS=0', async () => {
    process.env.OM_CF_DEF_CACHE_TTL_MS = '0'
    const { em, find } = buildFakeEm([fakeDef('priority', '000000000002')])
    const cache = buildMemoryCache()

    await loadCustomFieldDefinitionIndex({ em: em as any, entityIds: entityId, tenantId, cache })
    await loadCustomFieldDefinitionIndex({ em: em as any, entityIds: entityId, tenantId, cache })
    expect(find).toHaveBeenCalledTimes(2)
    expect(cache.set).not.toHaveBeenCalled()
  })

  it('writes tags that the existing entities:definitions invalidation hits', async () => {
    process.env.OM_CF_DEF_CACHE_TTL_MS = '300000'
    const { em } = buildFakeEm([fakeDef('priority', '000000000003')])
    const cache = buildMemoryCache()

    await loadCustomFieldDefinitionIndex({
      em: em as any,
      entityIds: entityId,
      tenantId,
      cache,
    })
    expect(cache.set).toHaveBeenCalledTimes(1)
    const writeOpts = cache.set.mock.calls[0]?.[2] as { tags?: string[] } | undefined
    expect(writeOpts?.tags).toEqual(
      expect.arrayContaining([
        `entities:definitions:${tenantId}`,
        `entities:definitions:${tenantId}:entity:${entityId}`,
      ]),
    )

    await cache.deleteByTags([`entities:definitions:${tenantId}:entity:${entityId}`])
    expect(cache.store.size).toBe(0)
  })

  it('keys distinguish different entity-id sets', async () => {
    process.env.OM_CF_DEF_CACHE_TTL_MS = '300000'
    const { em, find } = buildFakeEm([fakeDef('priority', '000000000004')])
    const cache = buildMemoryCache()

    await loadCustomFieldDefinitionIndex({ em: em as any, entityIds: entityId, tenantId, cache })
    await loadCustomFieldDefinitionIndex({ em: em as any, entityIds: 'other:entity', tenantId, cache })
    expect(find).toHaveBeenCalledTimes(2)
    expect(cache.store.size).toBe(2)
  })

  it('per-request micro-cache short-circuits inside one request scope', async () => {
    process.env.OM_CF_DEF_CACHE_TTL_MS = '0' // disable shared cache so we only see micro-cache effect
    const { em, find } = buildFakeEm([fakeDef('priority', '000000000005')])
    const ctx = {}
    await loadCustomFieldDefinitionIndex({ em: em as any, entityIds: entityId, tenantId, requestScope: ctx })
    await loadCustomFieldDefinitionIndex({ em: em as any, entityIds: entityId, tenantId, requestScope: ctx })
    expect(find).toHaveBeenCalledTimes(1)
  })
})
