import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

/**
 * TC-CONF-007: Readiness and cache admin under the cache provider extension
 * Source: .ai/specs/2026-11-24-pluggable-cache-providers.md (Verification → Application boundaries)
 *
 * Whatever cache selection the environment runs with (stock strategy or a registered
 * CACHE_PROVIDER), readiness stays 200 with the unchanged `{ status, ts }` body and the
 * cache admin API keeps serving consistent stats and an authorized purge.
 */
type CacheSegment = { segment: string; keyCount: number; keys: string[] }
type CacheStats = { generatedAt?: string; totalKeys?: number; segments?: CacheSegment[] }

function assertConsistentStats(stats: CacheStats): void {
  expect(Number.isInteger(stats.totalKeys)).toBe(true)
  expect((stats.totalKeys as number) >= 0).toBe(true)
  expect(Array.isArray(stats.segments)).toBe(true)
  const sum = (stats.segments as CacheSegment[]).reduce((acc, segment) => acc + segment.keyCount, 0)
  expect(stats.totalKeys, 'totalKeys must equal the sum of per-segment keyCount').toBe(sum)
}

test.describe('TC-CONF-007: Readiness and cache admin under the cache provider extension', () => {
  test('readiness reports ok with the unchanged response body', async ({ request }) => {
    const response = await request.get('/api/healthz')
    expect(response.status(), 'readiness should pass for the effective cache selection').toBe(200)

    const body = (await response.json()) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['status', 'ts'])
    expect(body.status).toBe('ok')
    expect(typeof body.ts).toBe('string')
  })

  test('serves cache stats and an authorized purge through the effective cache service', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const before = await apiRequest(request, 'GET', '/api/configs/cache', { token })
    expect(before.status(), 'admin should read cache stats').toBe(200)
    assertConsistentStats((await before.json()) as CacheStats)

    const purge = await apiRequest(request, 'POST', '/api/configs/cache', {
      token,
      data: { action: 'purgeAll' },
    })
    expect(purge.status(), 'admin should purge the cache').toBe(200)
    const purgeBody = (await purge.json()) as { action?: string; stats?: CacheStats }
    expect(purgeBody.action).toBe('purgeAll')
    assertConsistentStats(purgeBody.stats as CacheStats)

    const after = await apiRequest(request, 'GET', '/api/configs/cache', { token })
    expect(after.status()).toBe(200)
    assertConsistentStats((await after.json()) as CacheStats)
  })

  test('denies cache purge to a user without cache management access', async ({ request }) => {
    const token = await getAuthToken(request, 'employee')

    const response = await apiRequest(request, 'POST', '/api/configs/cache', {
      token,
      data: { action: 'purgeAll' },
    })
    expect(response.ok(), 'employee must not purge the cache').toBe(false)
    expect([401, 403]).toContain(response.status())
  })
})
