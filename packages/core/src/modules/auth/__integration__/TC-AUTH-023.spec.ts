import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

test.describe('TC-AUTH-023: Sidebar preferences & features list API', () => {
  test('should read sidebar preferences', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await apiRequest(request, 'GET', '/api/auth/sidebar/preferences', { token })
    expect(response.status(), 'GET /api/auth/sidebar/preferences should return 200').toBe(200)
    const body = await readJsonSafe<{
      locale?: string
      settings?: Record<string, unknown>
      canApplyToRoles?: boolean
      roles?: Array<Record<string, unknown>>
    }>(response)
    expect(typeof body?.locale).toBe('string')
    expect(body?.settings).toBeTruthy()
    expect(typeof body?.canApplyToRoles).toBe('boolean')
    expect(Array.isArray(body?.roles)).toBe(true)
  })

  test('should update sidebar preferences and restore', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    // Read current state
    const getResponse = await apiRequest(request, 'GET', '/api/auth/sidebar/preferences', { token })
    const original = await readJsonSafe<{
      settings?: { hiddenItems?: string[]; groupOrder?: string[] }
    }>(getResponse)

    // Update with a hidden item
    const putResponse = await apiRequest(request, 'PUT', '/api/auth/sidebar/preferences', {
      token,
      data: {
        hiddenItems: ['qa-hidden-item-test'],
      },
    })
    expect(putResponse.status(), 'PUT /api/auth/sidebar/preferences should return 200').toBe(200)
    const putBody = await readJsonSafe<{
      settings?: { hiddenItems?: string[] }
    }>(putResponse)
    expect(putBody?.settings?.hiddenItems).toContain('qa-hidden-item-test')

    // Restore original hidden items
    await apiRequest(request, 'PUT', '/api/auth/sidebar/preferences', {
      token,
      data: {
        hiddenItems: original?.settings?.hiddenItems ?? [],
      },
    })
  })

  test('should return all declared features', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await apiRequest(request, 'GET', '/api/auth/features', { token })
    expect(response.status(), 'GET /api/auth/features should return 200').toBe(200)
    const body = await readJsonSafe<{
      items?: Array<{ id?: string; title?: string; module?: string }>
      modules?: Array<{ id?: string; title?: string }>
    }>(response)

    expect(Array.isArray(body?.items)).toBe(true)
    expect((body?.items?.length ?? 0) > 0, 'Should return at least one feature').toBe(true)
    expect(Array.isArray(body?.modules)).toBe(true)
    expect((body?.modules?.length ?? 0) > 0, 'Should return at least one module').toBe(true)

    // Verify structure of first feature
    const firstFeature = body?.items?.[0]
    expect(typeof firstFeature?.id).toBe('string')
    expect(typeof firstFeature?.title).toBe('string')
    expect(typeof firstFeature?.module).toBe('string')
  })

  test('should deny features list to employee without auth.acl.manage', async ({ request }) => {
    const token = await getAuthToken(request, 'employee')

    const response = await apiRequest(request, 'GET', '/api/auth/features', { token })
    expect(response.status(), 'Employee GET /api/auth/features should be denied').toBeGreaterThanOrEqual(403)
  })
})
