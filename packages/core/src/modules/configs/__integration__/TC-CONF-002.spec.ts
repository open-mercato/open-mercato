import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

/**
 * TC-CONF-002: Cache statistics
 * Source: .ai/qa/scenarios/TC-ADMIN-010-cache-management.md + issue #2465
 *
 * GET /api/configs/cache returns a CrudCacheStats snapshot: totalKeys plus a
 * per-segment breakdown. totalKeys must equal the sum of each segment keyCount.
 */
type CacheSegment = { segment: string; keyCount: number; keys: string[] }
type CacheStats = { generatedAt?: string; totalKeys?: number; segments?: CacheSegment[] }

test.describe('TC-CONF-002: Cache statistics', () => {
  test('returns consistent cache statistics for an authorized admin', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await apiRequest(request, 'GET', '/api/configs/cache', { token })
    expect(response.status(), 'admin should be allowed to read cache stats').toBe(200)

    const body = (await response.json()) as CacheStats

    expect(typeof body.generatedAt).toBe('string')
    expect(typeof body.totalKeys).toBe('number')
    expect(Number.isInteger(body.totalKeys)).toBe(true)
    expect((body.totalKeys as number) >= 0).toBe(true)

    expect(Array.isArray(body.segments)).toBe(true)
    const segments = body.segments as CacheSegment[]
    for (const segment of segments) {
      expect(typeof segment.segment).toBe('string')
      expect(Number.isInteger(segment.keyCount)).toBe(true)
      expect(segment.keyCount >= 0).toBe(true)
    }

    const sum = segments.reduce((acc, segment) => acc + segment.keyCount, 0)
    expect(body.totalKeys, 'totalKeys must equal the sum of per-segment keyCount').toBe(sum)
  })

  test('denies cache statistics to a user without configs.cache.view', async ({ request }) => {
    const token = await getAuthToken(request, 'employee')

    const response = await apiRequest(request, 'GET', '/api/configs/cache', { token })
    expect(response.ok(), 'employee must not read cache stats').toBe(false)
    expect([401, 403]).toContain(response.status())
  })
})
