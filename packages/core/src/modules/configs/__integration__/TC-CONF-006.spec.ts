import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

/**
 * TC-CONF-006: List pending upgrade actions
 * Source: issue #2465
 *
 * GET /api/configs/upgrade-actions returns the current app version and a (possibly
 * empty) list of pending upgrade actions; each action carries the expected
 * descriptor fields. Access requires configs.manage.
 */
test.describe('TC-CONF-006: Upgrade actions listing', () => {
  test('returns version and a well-formed actions array for an admin', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await apiRequest(request, 'GET', '/api/configs/upgrade-actions', { token })
    expect(response.status(), 'admin should be allowed to list upgrade actions').toBe(200)

    const body = (await response.json()) as {
      version?: string
      actions?: Array<Record<string, unknown>>
    }
    expect(typeof body.version).toBe('string')
    expect((body.version as string).length).toBeGreaterThan(0)
    expect(Array.isArray(body.actions)).toBe(true)

    for (const action of body.actions as Array<Record<string, unknown>>) {
      expect(typeof action.id).toBe('string')
      expect(typeof action.version).toBe('string')
      expect(typeof action.message).toBe('string')
      expect(typeof action.ctaLabel).toBe('string')
      expect(typeof action.successMessage).toBe('string')
      expect(typeof action.loadingLabel).toBe('string')
    }
  })

  test('denies upgrade actions to a user without configs.manage', async ({ request }) => {
    const token = await getAuthToken(request, 'employee')

    const response = await apiRequest(request, 'GET', '/api/configs/upgrade-actions', { token })
    expect(response.ok(), 'employee must not list upgrade actions').toBe(false)
    expect([400, 401, 403]).toContain(response.status())
  })
})
