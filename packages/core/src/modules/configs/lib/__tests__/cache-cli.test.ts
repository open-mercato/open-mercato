import { createCacheService, runWithCacheTenant, type CacheStrategy } from '@open-mercato/cache'
import { collectCacheStats, executeCachePurge, previewCachePurge, type CachePurgeRequest } from '../cache-cli'

describe('cache-cli helpers', () => {
  let cache: CacheStrategy

  async function seedTenantData() {
    await runWithCacheTenant('tenant-a', async () => {
      await cache.set('nav:sidebar:en:user-1:tenant-a:org-a', { ok: true }, { tags: ['nav:sidebar:user:user-1'] })
      await cache.set('crud|auth|GET|/api/auth/admin/nav|user-1', { ok: true }, { tags: ['auth'] })
      await cache.set('custom:key:alpha', { ok: true }, { tags: ['alpha-tag'] })
      await cache.set('custom:key:beta', { ok: true }, { tags: ['beta-tag'] })
    })
    await runWithCacheTenant('tenant-b', async () => {
      await cache.set('nav:sidebar:en:user-2:tenant-b:org-b', { ok: true }, { tags: ['nav:sidebar:user:user-2'] })
    })
  }

  beforeEach(async () => {
    cache = createCacheService({ strategy: 'memory' })
    await seedTenantData()
  })

  it('collects tenant-scoped cache stats', async () => {
    const stats = await runWithCacheTenant('tenant-a', async () => collectCacheStats(cache))
    expect(stats.totalKeys).toBeGreaterThan(0)
    expect(stats.segments.some((segment) => segment.segment === 'admin-nav')).toBe(true)
  })

  it('previews and executes segment purges', async () => {
    const request: CachePurgeRequest = { kind: 'segment', segment: 'admin-nav' }
    const preview = await runWithCacheTenant('tenant-a', async () => previewCachePurge(cache, request))
    expect(preview.deleted).toBe(1)
    expect(preview.keys).toEqual(['crud|auth|GET|/api/auth/admin/nav|user-1'])

    const result = await runWithCacheTenant('tenant-a', async () => executeCachePurge(cache, request))
    expect(result.deleted).toBe(1)
    expect(await runWithCacheTenant('tenant-a', async () => cache.get('crud|auth|GET|/api/auth/admin/nav|user-1'))).toBeNull()
  })

  it('purges keys by exact tag', async () => {
    const request: CachePurgeRequest = { kind: 'tags', tags: ['alpha-tag'] }
    const result = await runWithCacheTenant('tenant-a', async () => executeCachePurge(cache, request))
    expect(result.deleted).toBe(1)
    expect(await runWithCacheTenant('tenant-a', async () => cache.get('custom:key:alpha'))).toBeNull()
    expect(await runWithCacheTenant('tenant-a', async () => cache.get('custom:key:beta'))).not.toBeNull()
  })

  it('purges keys by identifier token', async () => {
    const request: CachePurgeRequest = { kind: 'ids', ids: ['user-1'] }
    const preview = await runWithCacheTenant('tenant-a', async () => previewCachePurge(cache, request))
    expect(preview.keys).toEqual([
      'crud|auth|GET|/api/auth/admin/nav|user-1',
      'nav:sidebar:en:user-1:tenant-a:org-a',
    ])

    const result = await runWithCacheTenant('tenant-a', async () => executeCachePurge(cache, request))
    expect(result.deleted).toBe(2)
    expect(await runWithCacheTenant('tenant-a', async () => cache.get('nav:sidebar:en:user-1:tenant-a:org-a'))).toBeNull()
  })

  it('purges keys by pattern without touching other tenants', async () => {
    const request: CachePurgeRequest = { kind: 'pattern', pattern: 'nav:*' }
    const result = await runWithCacheTenant('tenant-a', async () => executeCachePurge(cache, request))
    expect(result.deleted).toBe(1)
    expect(await runWithCacheTenant('tenant-a', async () => cache.get('nav:sidebar:en:user-1:tenant-a:org-a'))).toBeNull()
    expect(await runWithCacheTenant('tenant-b', async () => cache.get('nav:sidebar:en:user-2:tenant-b:org-b'))).not.toBeNull()
  })
})
