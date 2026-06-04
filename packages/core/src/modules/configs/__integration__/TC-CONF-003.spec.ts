import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

/**
 * TC-CONF-003: Purge all cache
 * Source: issue #2465
 *
 * POST /api/configs/cache { action: 'purgeAll' } clears the cache and returns
 * the updated, internally-consistent CrudCacheStats snapshot.
 */
type CacheSegment = { segment: string; keyCount: number; keys: string[] }
type CacheStats = { generatedAt?: string; totalKeys?: number; segments?: CacheSegment[] }

function assertConsistentStats(stats: CacheStats): void {
  expect(typeof stats.totalKeys).toBe('number')
  expect(Number.isInteger(stats.totalKeys)).toBe(true)
  expect((stats.totalKeys as number) >= 0).toBe(true)
  expect(Array.isArray(stats.segments)).toBe(true)
  const sum = (stats.segments as CacheSegment[]).reduce((acc, segment) => acc + segment.keyCount, 0)
  expect(stats.totalKeys, 'totalKeys must equal the sum of per-segment keyCount').toBe(sum)
}

test.describe('TC-CONF-003: Purge all cache', () => {
  test('purges the entire cache and returns updated stats', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await apiRequest(request, 'POST', '/api/configs/cache', {
      token,
      data: { action: 'purgeAll' },
    })
    expect(response.status(), 'admin should be allowed to purge the cache').toBe(200)

    const body = (await response.json()) as { action?: string; stats?: CacheStats }
    expect(body.action).toBe('purgeAll')
    expect(body.stats && typeof body.stats === 'object').toBeTruthy()
    assertConsistentStats(body.stats as CacheStats)

    // A follow-up read should still return a valid, consistent snapshot.
    const after = await apiRequest(request, 'GET', '/api/configs/cache', { token })
    expect(after.status()).toBe(200)
    assertConsistentStats((await after.json()) as CacheStats)
  })
})
