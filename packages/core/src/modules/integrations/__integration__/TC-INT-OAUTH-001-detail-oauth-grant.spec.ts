import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  TEST_OAUTH_GRANT_INTEGRATION_ID,
  connectTestGrant,
  corruptTestGrant,
  isOAuthGrantTestRouteAvailable,
  refreshTestGrant,
  resetTestGrants,
} from '@open-mercato/core/helpers/integration/oauthGrantTestRoute'

type DetailBody = {
  integration?: { id?: string; detailPage?: { connectTabId?: string } }
  oauthGrant?: { status?: string } | null
}

const DETAIL_PATH = `/api/integrations/${TEST_OAUTH_GRANT_INTEGRATION_ID}`

async function readDetail(request: APIRequestContext, token: string): Promise<{ body: DetailBody; raw: string }> {
  const response = await apiRequest(request, 'GET', DETAIL_PATH, { token })
  expect(response.status(), `GET ${DETAIL_PATH} should return 200`).toBe(200)
  const raw = await response.text()
  const body = JSON.parse(raw) as DetailBody
  return { body, raw }
}

async function expectGrantField(request: APIRequestContext, token: string, expected: { status: string } | null) {
  const { body, raw } = await readDetail(request, token)
  expect(body.oauthGrant).toEqual(expected)
  if (expected) expect(Object.keys(body.oauthGrant ?? {})).toEqual(['status'])
  expect(raw).not.toMatch(/accessToken|refreshToken|access_token|refresh_token/)
}

/**
 * TC-INT-OAUTH-001 (A36): `GET /api/integrations/:id` reports the tenant-level OAuth grant of the
 * active organization as `oauthGrant: { status } | null`, and returns `detailPage.connectTabId`.
 * Fixtures come from the flag-gated test route (`OM_ENABLE_TEST_OAUTH_GRANTS`).
 */
test.describe('TC-INT-OAUTH-001: integration detail GET reports the OAuth grant status', () => {
  test.describe.configure({ timeout: 60_000 })

  test('oauthGrant follows reset, connect, an invalid_grant refresh and a corrupted grant', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    test.skip(
      !(await isOAuthGrantTestRouteAvailable(request, token)),
      'OM_ENABLE_TEST_OAUTH_GRANTS is off in the app under test',
    )

    await resetTestGrants(request, token)
    try {
      const { body } = await readDetail(request, token)
      expect(body.integration?.id).toBe(TEST_OAUTH_GRANT_INTEGRATION_ID)
      expect(body.integration?.detailPage?.connectTabId).toBe('health')
      expect(body.oauthGrant).toBeNull()

      await connectTestGrant(request, token)
      await expectGrantField(request, token, { status: 'active' })

      const refreshed = await refreshTestGrant(request, token, { outcome: 'invalid_grant' })
      expect(refreshed.result).toBe('grant_invalidated')
      await expectGrantField(request, token, { status: 'invalidated' })

      expect(await corruptTestGrant(request, token)).toBe(true)
      await expectGrantField(request, token, { status: 'unavailable' })

      await resetTestGrants(request, token)
      await expectGrantField(request, token, null)
    } finally {
      await resetTestGrants(request, token).catch(() => undefined)
    }
  })

  test('an integration without a grant reports oauthGrant null', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const listResponse = await apiRequest(request, 'GET', '/api/integrations?pageSize=1', { token })
    expect(listResponse.status()).toBe(200)
    const list = await readJsonSafe<{ items?: Array<{ id?: string }> }>(listResponse)
    const firstId = list?.items?.find((item) => item.id && item.id !== TEST_OAUTH_GRANT_INTEGRATION_ID)?.id
    test.skip(!firstId, 'No other integration is registered in the app under test')

    const response = await apiRequest(request, 'GET', `/api/integrations/${encodeURIComponent(firstId as string)}`, { token })
    expect(response.status()).toBe(200)
    const body = await readJsonSafe<DetailBody>(response)
    expect(body?.oauthGrant).toBeNull()
  })
})
