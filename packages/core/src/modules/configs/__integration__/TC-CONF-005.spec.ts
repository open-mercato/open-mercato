import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

/**
 * TC-CONF-005: Cache management RBAC
 * Source: issue #2465
 *
 * A user without configs.cache.manage must not be able to trigger destructive
 * cache operations (purgeAll / purgeSegment).
 */
test.describe('TC-CONF-005: Cache management RBAC', () => {
  test('denies purgeAll to a user without configs.cache.manage', async ({ request }) => {
    const token = await getAuthToken(request, 'employee')

    const response = await apiRequest(request, 'POST', '/api/configs/cache', {
      token,
      data: { action: 'purgeAll' },
    })
    expect(response.ok(), 'employee must not purge the cache').toBe(false)
    expect([401, 403]).toContain(response.status())
  })

  test('denies purgeSegment to a user without configs.cache.manage', async ({ request }) => {
    const token = await getAuthToken(request, 'employee')

    const response = await apiRequest(request, 'POST', '/api/configs/cache', {
      token,
      data: { action: 'purgeSegment', segment: 'crud|customers.person' },
    })
    expect(response.ok(), 'employee must not purge a cache segment').toBe(false)
    expect([401, 403]).toContain(response.status())
  })
})
