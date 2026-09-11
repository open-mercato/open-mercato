import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type BlockedBody = { ok?: boolean; code?: string; section?: string; message?: string }

/**
 * TC-PHONE-002 — the pull refuses to run before Tillio is configured.
 *
 * The readiness gate returns 409 before `tillioAdapter.fetchCalls` is ever reached, so
 * this exercises the real POST path without any network traffic to Tillio and without
 * ingesting anything. That ordering is the point of the test: a regression that moved
 * the gate below the fetch would turn an unconfigured tenant into a live provider call.
 *
 * A pull against a real Tillio environment needs Ringostat credentials and is therefore
 * a deliberate manual check, not an automated one.
 */
test.describe('TC-PHONE-002: Tillio pull blocked before reaching the provider', () => {
  test('returns a structured 409 when the environment is not configured', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const response = await apiRequest(request, 'POST', '/api/tillio/pull', {
      token,
      data: { from: '2026-03-01', to: '2026-03-02' },
    })

    expect(response.status(), 'an unconfigured environment must block the pull').toBe(409)

    const body = await readJsonSafe<BlockedBody>(response)
    expect(body?.ok).toBe(false)
    expect(body?.code, 'the blocker code drives which settings section the UI opens').toBe('environment_not_ready')
    expect(body?.section, 'environment blockers route to the environment section').toBe('environment')
    expect(body?.message, 'the blocker carries an actionable message').toBeTruthy()
  })

  test('rejects a reversed day range before touching readiness', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const response = await apiRequest(request, 'POST', '/api/tillio/pull', {
      token,
      data: { from: '2026-03-02', to: '2026-03-01' },
    })

    expect(response.status(), 'from must not be after to').toBe(400)
  })
})
