import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

/**
 * TC-PLAT-001: Platform map API
 * Source: .ai/specs/2026-06-17-platform-map-introspection.md
 */
test.describe('TC-PLAT-001: Platform map API', () => {
  test('returns a PlatformMap payload for an authorized admin', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await apiRequest(request, 'GET', '/api/platform/inspect?surface=module&tier=1', { token })
    expect(response.status(), 'admin should read platform map in dev/test').toBe(200)

    const body = (await response.json()) as {
      schemaVersion?: number
      surfaces?: Record<string, { rows?: unknown[] }>
    }

    expect(body.schemaVersion).toBe(1)
    expect(body.surfaces?.module?.rows?.length).toBeGreaterThan(0)
  })

  test('denies platform map to a user without platform.inspect.view', async ({ request }) => {
    const token = await getAuthToken(request, 'employee')

    const response = await apiRequest(request, 'GET', '/api/platform/inspect?surface=module', { token })
    expect(response.ok(), 'employee must not read platform map').toBe(false)
    expect([401, 403]).toContain(response.status())
  })
})
