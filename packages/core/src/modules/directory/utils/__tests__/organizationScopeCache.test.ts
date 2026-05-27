/** @jest-environment node */

import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import {
  resolveOrganizationScopeForRequest,
  invalidateOrganizationScopeCacheForTenant,
  invalidateOrganizationScopeCacheForUser,
} from '../organizationScope'

function createMockEm(orgs: Array<{ id: string; descendantIds: string[] }>) {
  const find = jest.fn((_entity: unknown, filter: { id?: { $in: string[] }; tenant?: string }) => {
    const requestedIds = filter?.id?.$in ?? []
    return Promise.resolve(orgs.filter((row) => requestedIds.includes(row.id)))
  })
  return { find } as unknown as EntityManager
}

function createMockRbac() {
  return {
    loadAcl: jest.fn().mockResolvedValue({
      isSuperAdmin: false,
      features: [],
      organizations: ['org-home'],
    }),
  } as unknown as RbacService
}

function createMemoryCache() {
  const store = new Map<string, { value: unknown; tags: string[] }>()
  return {
    store,
    get: jest.fn(async (key: string) => store.get(key)?.value ?? null),
    set: jest.fn(async (key: string, value: unknown, opts?: { tags?: string[] }) => {
      store.set(key, { value, tags: opts?.tags ?? [] })
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

function createContainer(em: EntityManager, rbac: RbacService, cache: unknown | null): AwilixContainer {
  return {
    resolve: (key: string) => {
      if (key === 'em') return em
      if (key === 'rbacService') return rbac
      if (key === 'cache') {
        if (cache === null) throw new Error('cache not registered')
        return cache
      }
      throw new Error(`unexpected DI key: ${key}`)
    },
  } as unknown as AwilixContainer
}

function auth(): AuthContext {
  return {
    sub: '00000000-0000-4000-8000-000000000001',
    tenantId: 'tenant-1',
    orgId: 'org-home',
    isSuperAdmin: false,
  } as AuthContext
}

describe('resolveOrganizationScopeForRequest caching (Phase 4)', () => {
  const originalTtl = process.env.OM_ORG_SCOPE_CACHE_TTL_MS

  afterEach(() => {
    if (originalTtl === undefined) delete process.env.OM_ORG_SCOPE_CACHE_TTL_MS
    else process.env.OM_ORG_SCOPE_CACHE_TTL_MS = originalTtl
  })

  it('caches the scope for the (user, tenant, selectedOrg, requestedTenant) tuple', async () => {
    process.env.OM_ORG_SCOPE_CACHE_TTL_MS = '60000'
    const em = createMockEm([{ id: 'org-home', descendantIds: [] }])
    const rbac = createMockRbac()
    const cache = createMemoryCache()
    const container = createContainer(em, rbac, cache)

    const first = await resolveOrganizationScopeForRequest({ container, auth: auth() })
    const second = await resolveOrganizationScopeForRequest({ container, auth: auth() })

    expect(first).toEqual(second)
    expect(cache.set).toHaveBeenCalledTimes(1)
    expect(cache.get).toHaveBeenCalledTimes(2)
    expect((rbac.loadAcl as jest.Mock).mock.calls.length).toBe(1)
  })

  it('does not cache when OM_ORG_SCOPE_CACHE_TTL_MS=0', async () => {
    process.env.OM_ORG_SCOPE_CACHE_TTL_MS = '0'
    const em = createMockEm([{ id: 'org-home', descendantIds: [] }])
    const rbac = createMockRbac()
    const cache = createMemoryCache()
    const container = createContainer(em, rbac, cache)

    await resolveOrganizationScopeForRequest({ container, auth: auth() })
    await resolveOrganizationScopeForRequest({ container, auth: auth() })
    expect(cache.set).not.toHaveBeenCalled()
    expect((rbac.loadAcl as jest.Mock).mock.calls.length).toBe(2)
  })

  it('invalidateOrganizationScopeCacheForTenant drops entries tagged for that tenant', async () => {
    process.env.OM_ORG_SCOPE_CACHE_TTL_MS = '60000'
    const em = createMockEm([{ id: 'org-home', descendantIds: [] }])
    const rbac = createMockRbac()
    const cache = createMemoryCache()
    const container = createContainer(em, rbac, cache)

    await resolveOrganizationScopeForRequest({ container, auth: auth() })
    expect(cache.store.size).toBe(1)
    await invalidateOrganizationScopeCacheForTenant(container, 'tenant-1')
    expect(cache.store.size).toBe(0)
  })

  it('invalidateOrganizationScopeCacheForUser drops only that user', async () => {
    process.env.OM_ORG_SCOPE_CACHE_TTL_MS = '60000'
    const em = createMockEm([{ id: 'org-home', descendantIds: [] }])
    const rbac = createMockRbac()
    const cache = createMemoryCache()
    const container = createContainer(em, rbac, cache)

    await resolveOrganizationScopeForRequest({ container, auth: auth() })
    await resolveOrganizationScopeForRequest({
      container,
      auth: { ...auth(), sub: '00000000-0000-4000-8000-000000000002' } as AuthContext,
    })
    expect(cache.store.size).toBe(2)
    await invalidateOrganizationScopeCacheForUser(container, '00000000-0000-4000-8000-000000000001')
    expect(cache.store.size).toBe(1)
  })

  it('falls back to uncached resolution when cache is not registered', async () => {
    process.env.OM_ORG_SCOPE_CACHE_TTL_MS = '60000'
    const em = createMockEm([{ id: 'org-home', descendantIds: [] }])
    const rbac = createMockRbac()
    const container = createContainer(em, rbac, null)
    const result = await resolveOrganizationScopeForRequest({ container, auth: auth() })
    expect(result.tenantId).toBe('tenant-1')
  })
})
