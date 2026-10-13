import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { isXeroTestFakesAvailable, postXeroFakesAction, resetXeroFakes, startXeroFakes } from './helpers/xeroTestFakes'

const CREDENTIALS_PATH = '/api/integrations/sync_xero/credentials'

async function saveClientConfiguration(request: APIRequestContext, token: string, clientId: string, clientSecret: string): Promise<void> {
  const response = await apiRequest(request, 'PUT', CREDENTIALS_PATH, { token, data: { credentials: { clientId, clientSecret } } })
  expect(response.status(), await response.text()).toBe(200)
}

/**
 * TC-XERO-005: the test-only seam route never takes over an organization that holds real Xero
 * state, and its reset never erases such an organization's rows.
 */
test.describe('TC-XERO-005: the Xero test seam refuses organizations with real Xero state', () => {
  let token = ''

  test.beforeEach(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
    test.skip(!(await isXeroTestFakesAvailable(request, token)), 'OM_ENABLE_TEST_OAUTH_GRANTS is off in the app under test')
    await resetXeroFakes(request, token)
  })

  test.afterEach(async ({ request }) => {
    if (!token) return
    await resetXeroFakes(request, token).catch(() => undefined)
    await saveClientConfiguration(request, token, '', '').catch(() => undefined)
  })

  test('start answers 409 and reset refuses an organization with a real Client ID', async ({ request }) => {
    await saveClientConfiguration(request, token, 'A1B2C3D4E5F60718293A4B5C6D7E8F90', 'real-looking-secret')

    const start = await postXeroFakesAction(request, token, { action: 'start' })
    expect(start.status).toBe(409)
    expect(start.body).toMatchObject({ code: 'real_xero_state' })

    const reset = await postXeroFakesAction(request, token, { action: 'reset' })
    expect(reset.status).toBe(409)
    expect(reset.body).toMatchObject({ code: 'not_seam_organization' })

    const credentials = await apiRequest(request, 'GET', CREDENTIALS_PATH, { token })
    expect(JSON.stringify(await credentials.json())).toContain('A1B2C3D4E5F60718293A4B5C6D7E8F90')
  })

  test('start succeeds once the organization holds no Xero state, and no response carries the secret', async ({ request }) => {
    await saveClientConfiguration(request, token, '', '')
    const started = await startXeroFakes(request, token)
    expect(started.clientId).toMatch(/^om_test_seam_[0-9a-f]+$/)
    expect(Object.keys(started).sort()).toEqual(['authorizationEndpoint', 'clientId', 'started'])

    const reset = await postXeroFakesAction(request, token, { action: 'reset' })
    expect(reset.status).toBe(200)
  })
})
