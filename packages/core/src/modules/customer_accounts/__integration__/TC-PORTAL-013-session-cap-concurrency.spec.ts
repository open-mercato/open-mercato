import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCustomerUserFixture,
  deleteCustomerUserFixture,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'

/**
 * TC-PORTAL-013 [P2]: concurrent portal logins of one customer cannot exceed the session cap.
 *
 * Each login counted the customer's live sessions, revoked the overflow and inserted its own
 * session with nothing serializing those steps, so logins that overlapped all read the same
 * count and the customer kept more sessions than MAX_CUSTOMER_SESSIONS_PER_USER.
 * The count, revoke and insert now run in one transaction under a per-customer advisory lock.
 * The integration environment does not set MAX_CUSTOMER_SESSIONS_PER_USER, so the cap is the
 * default of 5.
 *
 * Surfaces:
 *   - POST /api/customer_accounts/login (sequential, then a concurrent burst)
 *   - GET /api/customer_accounts/admin/users/:id (live sessions with their decrypted user agent)
 */

const DEFAULT_SESSION_CAP = 5
const SEQUENTIAL_LOGINS = DEFAULT_SESSION_CAP - 1
const CONCURRENT_LOGINS = 5
const USER_AGENT_PREFIX = 'tc-portal-013'

function login(
  request: APIRequestContext,
  input: { email: string; password: string; tenantId: string; userAgent: string },
): Promise<APIResponse> {
  return request.post('/api/customer_accounts/login', {
    data: { email: input.email, password: input.password, tenantId: input.tenantId },
    headers: { 'Content-Type': 'application/json', 'User-Agent': input.userAgent },
  })
}

async function listLiveSessions(
  request: APIRequestContext,
  adminToken: string,
  userId: string,
): Promise<Array<{ id: string; userAgent: string | null }>> {
  const response = await apiRequest(request, 'GET', `/api/customer_accounts/admin/users/${userId}`, {
    token: adminToken,
  })
  expect(response.status(), 'admin user detail must load').toBe(200)
  const body = (await response.json()) as { sessions: Array<{ id: string; userAgent: string | null }> }
  return body.sessions
}

test.describe('TC-PORTAL-013: portal session cap holds under concurrent logins', () => {
  test.setTimeout(60_000)

  test('a burst of concurrent logins leaves at most the cap of live sessions', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)
    let userId: string | null = null

    try {
      const user = await createCustomerUserFixture(request, adminToken, {})
      userId = user.id
      const credentials = { email: user.email, password: user.password, tenantId }

      for (let index = 0; index < SEQUENTIAL_LOGINS; index += 1) {
        const response = await login(request, { ...credentials, userAgent: `${USER_AGENT_PREFIX}-sequential-${index}` })
        expect(response.status(), `sequential login ${index + 1} must succeed`).toBe(200)
      }
      expect(await listLiveSessions(request, adminToken, user.id), 'sequential logins stay below the cap')
        .toHaveLength(SEQUENTIAL_LOGINS)

      const burst = await Promise.all(
        Array.from({ length: CONCURRENT_LOGINS }, (_, index) =>
          login(request, { ...credentials, userAgent: `${USER_AGENT_PREFIX}-burst-${index}` }),
        ),
      )
      const succeeded = burst.filter((response) => response.status() === 200).length
      expect(succeeded, 'the concurrent logins must succeed').toBe(CONCURRENT_LOGINS)

      const afterBurst = await listLiveSessions(request, adminToken, user.id)
      expect(afterBurst, 'the concurrent burst must not exceed the cap').toHaveLength(DEFAULT_SESSION_CAP)
      const burstSessions = afterBurst.filter((session) => session.userAgent?.startsWith(`${USER_AGENT_PREFIX}-burst-`))
      expect(burstSessions, 'every burst login keeps its session with a readable user agent').toHaveLength(CONCURRENT_LOGINS)

      const lastLogin = await login(request, { ...credentials, userAgent: `${USER_AGENT_PREFIX}-last` })
      expect(lastLogin.status(), 'a later login must succeed').toBe(200)
      expect(await listLiveSessions(request, adminToken, user.id), 'a later login keeps the cap')
        .toHaveLength(DEFAULT_SESSION_CAP)
    } finally {
      await deleteCustomerUserFixture(request, adminToken, userId)
    }
  })
})
