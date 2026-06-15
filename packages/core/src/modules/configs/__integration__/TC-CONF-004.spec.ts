import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

/**
 * TC-CONF-004: Purge a specific cache segment
 * Source: issue #2465
 *
 * POST /api/configs/cache { action: 'purgeSegment', segment } returns the deleted count
 * and updated stats; an empty/missing segment is rejected with 400.
 */
test.describe('TC-CONF-004: Purge cache segment', () => {
  test('purges a named segment and echoes the deleted count', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const segment = 'crud|customers.person'

    const response = await apiRequest(request, 'POST', '/api/configs/cache', {
      token,
      data: { action: 'purgeSegment', segment },
    })
    expect(response.status(), 'admin should be allowed to purge a cache segment').toBe(200)

    const body = (await response.json()) as {
      action?: string
      segment?: string
      deleted?: number
      stats?: { total?: number; segments?: Record<string, number> }
    }
    expect(body.action).toBe('purgeSegment')
    expect(body.segment).toBe(segment)
    expect(Number.isInteger(body.deleted)).toBe(true)
    expect((body.deleted as number) >= 0).toBe(true)
    expect(body.stats && typeof body.stats === 'object').toBeTruthy()
  })

  test('rejects a purgeSegment request without a segment identifier', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await apiRequest(request, 'POST', '/api/configs/cache', {
      token,
      data: { action: 'purgeSegment', segment: '' },
    })
    expect(response.status(), 'missing segment must be a 400').toBe(400)
    const body = (await response.json()) as { error?: string }
    expect(typeof body.error).toBe('string')
  })
})
