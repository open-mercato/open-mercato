import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type OperatorsBody = {
  ok?: boolean
  environmentReady?: boolean
  tenantSystemId?: string | null
  supportedPlugins?: string[]
  operators?: Array<{ id?: string; plugin?: string; stale?: boolean }>
  defaultOperatorId?: string | null
  envDrift?: boolean
}
type BlockedBody = { ok?: boolean; code?: string; section?: string; message?: string }

/**
 * TC-PHONE-003 — the operator routes answer correctly before Tillio is configured.
 *
 * Attaching a real operator calls Tillio (`addConfig`) and needs a Ringostat key, so the
 * live path stays a manual check. Everything asserted here stops before the network:
 * the listing reads credentials out of the database, the attach is refused by the
 * environment gate ahead of `attachOperator`, and detaching an unknown id returns early
 * without resolving an environment at all.
 */
test.describe('TC-PHONE-003: Tillio operators', () => {
  test('lists an empty operator set on an unconfigured environment', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const response = await apiRequest(request, 'GET', '/api/tillio/operators', { token })

    expect(response.status(), 'the operator listing should be reachable').toBe(200)

    const body = await readJsonSafe<OperatorsBody>(response)
    expect(body?.ok).toBe(true)
    expect(body?.environmentReady, 'no credentials means the environment is not ready').toBe(false)
    expect(body?.operators, 'no operators can exist without an environment').toEqual([])
    expect(body?.defaultOperatorId).toBeNull()
    expect(body?.tenantSystemId).toBeNull()
    expect(body?.envDrift, 'drift is meaningless with no operators attached').toBe(false)
    expect(body?.supportedPlugins, 'the UI builds its plugin picker from this list').toEqual(['Ringostat'])
  })

  test('refuses to attach an operator before the environment is healthy', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const response = await apiRequest(request, 'POST', '/api/tillio/operators', {
      token,
      data: { plugin: 'Ringostat', config: { key: 'qa-tillio-003-never-used' } },
    })

    expect(response.status(), 'attaching must be gated on a healthy environment').toBe(409)

    const body = await readJsonSafe<BlockedBody>(response)
    expect(body?.ok).toBe(false)
    expect(body?.code).toBe('environment_not_ready')
    expect(body?.section, 'the blocker routes the UI to the environment section').toBe('environment')
  })

  test('rejects an unsupported plugin', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const response = await apiRequest(request, 'POST', '/api/tillio/operators', {
      token,
      data: { plugin: 'Twilio', config: { key: 'qa-tillio-003-never-used' } },
    })

    expect(response.status(), 'only Ringostat is a supported plugin today').toBe(400)
  })

  test('detaching an unknown operator reports that nothing was detached', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const response = await apiRequest(request, 'DELETE', '/api/tillio/operators/qa-tillio-003-missing', { token })

    expect(response.status()).toBe(200)
    const body = await readJsonSafe<{ ok?: boolean; detached?: boolean }>(response)
    expect(body?.ok).toBe(true)
    expect(body?.detached, 'an unknown id detaches nothing rather than erroring').toBe(false)
  })
})
