import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

/**
 * TC-CONF-001: System status snapshot
 * Source: .ai/qa/scenarios/TC-ADMIN-009-system-status-view.md + issue #2465
 *
 * GET /api/configs/system-status returns a structured health snapshot for admins and
 * is denied for users lacking the configs.system_status.view feature.
 */
const RUNTIME_MODES = ['development', 'production', 'test', 'unknown']
const STATES = ['enabled', 'disabled', 'set', 'unset', 'unknown']

test.describe('TC-CONF-001: System status snapshot', () => {
  test('returns a valid system status snapshot for an authorized admin', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await apiRequest(request, 'GET', '/api/configs/system-status', { token })
    expect(response.status(), 'admin should be allowed to read system status').toBe(200)

    const body = (await response.json()) as {
      generatedAt?: string
      runtimeMode?: string
      categories?: Array<{ key?: string; labelKey?: string; items?: Array<Record<string, unknown>> }>
    }

    expect(typeof body.generatedAt).toBe('string')
    expect(Number.isNaN(new Date(body.generatedAt as string).getTime())).toBe(false)
    expect(RUNTIME_MODES).toContain(body.runtimeMode)
    expect(Array.isArray(body.categories)).toBe(true)
    expect((body.categories as unknown[]).length).toBeGreaterThan(0)

    const firstCategory = (body.categories as Array<{ key?: string; labelKey?: string; items?: Array<Record<string, unknown>> }>)[0]
    expect(typeof firstCategory.key).toBe('string')
    expect(typeof firstCategory.labelKey).toBe('string')
    expect(Array.isArray(firstCategory.items)).toBe(true)

    const itemWithState = (body.categories as Array<{ items?: Array<Record<string, unknown>> }>)
      .flatMap((category) => category.items ?? [])
      .find((item) => typeof item.state === 'string')
    expect(itemWithState, 'snapshot should expose at least one status item').toBeTruthy()
    expect(STATES).toContain((itemWithState as Record<string, unknown>).state)
  })

  test('denies system status to a user without configs.system_status.view', async ({ request }) => {
    const token = await getAuthToken(request, 'employee')

    const response = await apiRequest(request, 'GET', '/api/configs/system-status', { token })
    expect(response.ok(), 'employee must not read system status').toBe(false)
    expect([401, 403]).toContain(response.status())
  })
})
