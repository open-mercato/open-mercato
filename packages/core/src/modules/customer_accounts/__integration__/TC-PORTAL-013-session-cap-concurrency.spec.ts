import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  createCustomerUserFixture,
  deleteCustomerUserFixture,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'

/**
 * TC-PORTAL-013 [P2]: concurrent portal logins of one customer cannot exceed the session cap.
 *
 * Each login counted the customer's live sessions, revoked the overflow and inserted its own
 * session with nothing serializing those steps, so logins that overlapped all read the same
 * count and the customer kept more sessions than MAX_CUSTOMER_SESSIONS_PER_USER (default 5).
 * The count, revoke and insert now run in one transaction under a per-customer advisory lock.
 *
 * Surfaces:
 *   - POST /api/customer_accounts/login (sequential, then a concurrent burst)
 *   - customer_user_sessions live rows, read directly because no portal API lists another
 *     device's revoked state
 */

const DEFAULT_SESSION_CAP = 5
const SEQUENTIAL_LOGINS = DEFAULT_SESSION_CAP - 1
const CONCURRENT_LOGINS = 5

function login(request: APIRequestContext, email: string, password: string, tenantId: string): Promise<APIResponse> {
  return request.post('/api/customer_accounts/login', {
    data: { email, password, tenantId },
    headers: { 'Content-Type': 'application/json' },
  })
}

async function countLiveSessions(userId: string): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ live: string }>(
      'select count(*)::text as live from customer_user_sessions where user_id = $1 and deleted_at is null and expires_at > now()',
      [userId],
    )
    return Number(result.rows[0]?.live ?? -1)
  })
}

test.describe('TC-PORTAL-013: portal session cap holds under concurrent logins', () => {
  test('a burst of concurrent logins leaves at most the cap of live sessions', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)
    let userId: string | null = null

    try {
      const user = await createCustomerUserFixture(request, adminToken, {})
      userId = user.id

      for (let index = 0; index < SEQUENTIAL_LOGINS; index += 1) {
        await portalLogin(request, { email: user.email, password: user.password, tenantId })
      }
      expect(await countLiveSessions(user.id), 'sequential logins stay below the cap').toBe(SEQUENTIAL_LOGINS)

      const burst = await Promise.all(
        Array.from({ length: CONCURRENT_LOGINS }, () => login(request, user.email, user.password, tenantId)),
      )
      const succeeded = burst.filter((response) => response.status() === 200).length
      expect(succeeded, 'the concurrent logins must succeed').toBe(CONCURRENT_LOGINS)

      expect(await countLiveSessions(user.id), 'the concurrent burst must not exceed the cap').toBe(DEFAULT_SESSION_CAP)

      await portalLogin(request, { email: user.email, password: user.password, tenantId })
      expect(await countLiveSessions(user.id), 'a later login keeps the cap').toBe(DEFAULT_SESSION_CAP)
    } finally {
      await deleteCustomerUserFixture(request, adminToken, userId)
    }
  })
})
