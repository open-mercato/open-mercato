import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  createCustomerUserFixture,
  deleteCustomerUserFixture,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'

/**
 * TC-PORTAL-010 [P1]: concurrent wrong-password portal logins are all counted, and the account
 * locks at the fifth failure (#7232).
 *
 * The failed-login counter used to be computed from the row each request had loaded before its
 * bcrypt comparison and written back as a literal, so concurrent failures overwrote each other
 * and the account stayed below the lockout threshold. The increment and the lock-on-threshold
 * are now a single atomic UPDATE.
 *
 * Surfaces:
 *   - POST /api/customer_accounts/login (wrong password, then the correct one while locked)
 *   - GET /api/customer_accounts/admin/users/[id] (lockedUntil)
 *   - customer_users.failed_login_attempts, read directly because no API returns it
 */

type LoginResponse = { ok?: boolean; error?: string }
type AdminUserDetail = { ok?: boolean; lockedUntil?: string | null }

const GENERIC_LOGIN_ERROR = 'Invalid email or password'

function login(request: APIRequestContext, email: string, password: string, tenantId: string): Promise<APIResponse> {
  return request.post('/api/customer_accounts/login', {
    data: { email, password, tenantId },
    headers: { 'Content-Type': 'application/json' },
  })
}

async function readLockedUntil(request: APIRequestContext, adminToken: string, userId: string): Promise<string | null> {
  const response = await apiRequest(request, 'GET', `/api/customer_accounts/admin/users/${userId}`, { token: adminToken })
  expect(response.status(), 'admin user detail should load').toBe(200)
  const body = await readJsonSafe<AdminUserDetail>(response)
  return body?.lockedUntil ?? null
}

async function readFailedAttempts(userId: string): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ failed_login_attempts: number }>(
      'select failed_login_attempts from customer_users where id = $1',
      [userId],
    )
    return Number(result.rows[0]?.failed_login_attempts ?? -1)
  })
}

async function expectGenericFailure(response: APIResponse, label: string): Promise<void> {
  expect(response.status(), `${label} should answer 401`).toBe(401)
  expect((await readJsonSafe<LoginResponse>(response))?.error, `${label} should keep the generic error`).toBe(GENERIC_LOGIN_ERROR)
}

test.describe('TC-PORTAL-010: portal login lockout counts concurrent failures', () => {
  test('four concurrent failures and one more lock the account, and the correct password is then refused', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)
    let userId: string | null = null

    try {
      const user = await createCustomerUserFixture(request, adminToken, {})
      userId = user.id
      const wrongPassword = `${user.password}-wrong`

      const concurrent = await Promise.all(
        Array.from({ length: 4 }, () => login(request, user.email, wrongPassword, tenantId)),
      )
      for (const [index, response] of concurrent.entries()) {
        await expectGenericFailure(response, `concurrent wrong-password login ${index + 1}`)
      }
      expect(await readFailedAttempts(user.id), 'every concurrent failure must be counted').toBe(4)
      expect(await readLockedUntil(request, adminToken, user.id), 'four failures stay below the threshold').toBeNull()

      await expectGenericFailure(await login(request, user.email, wrongPassword, tenantId), 'the fifth wrong-password login')
      expect(await readFailedAttempts(user.id), 'the fifth failure must be counted').toBe(5)
      const lockedUntil = await readLockedUntil(request, adminToken, user.id)
      expect(lockedUntil, 'the fifth counted failure must lock the account').not.toBeNull()
      expect(new Date(lockedUntil ?? 0).getTime(), 'the lock must end in the future').toBeGreaterThan(Date.now())

      await expectGenericFailure(
        await login(request, user.email, user.password, tenantId),
        'the correct password during the lockout',
      )
    } finally {
      await deleteCustomerUserFixture(request, adminToken, userId)
    }
  })
})
