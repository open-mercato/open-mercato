import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type ReadinessBody = {
  ok?: boolean
  environmentReady?: boolean
  operatorAttached?: boolean
  envDrift?: boolean
  blocker?: string | null
  operatorId?: string | null
  plugin?: string | null
}

/**
 * TC-PHONE-001 — the pull readiness probe reports an unconfigured Tillio environment.
 *
 * GET /api/tillio/pull only reads config out of the database; it never calls Tillio.
 * On a fresh environment no Tillio credentials exist, so readiness must report the
 * `environment_not_ready` blocker rather than erroring. This asserts the module's own
 * readiness contract — the blocker precedence rules themselves are unit-tested in
 * packages/tillio/src/modules/tillio/__tests__/pull-readiness.test.ts.
 */
test.describe('TC-PHONE-001: Tillio pull readiness', () => {
  test('reports environment_not_ready when Tillio is not configured', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const response = await apiRequest(request, 'GET', '/api/tillio/pull', { token })

    expect(response.status(), 'the readiness probe should be reachable').toBe(200)

    const body = await readJsonSafe<ReadinessBody>(response)
    expect(body?.ok, 'readiness responds ok even when blocked').toBe(true)
    expect(body?.environmentReady, 'no Tillio credentials means the environment is not ready').toBe(false)
    expect(body?.operatorAttached, 'no operator can be attached without an environment').toBe(false)
    expect(body?.blocker, 'the environment blocker should be reported').toBe('environment_not_ready')
    expect(body?.operatorId, 'no operator id without an operator').toBeNull()
  })
})
