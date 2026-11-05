import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type AdminUsersResponse = {
  ok: boolean
  items: Array<{ id: string; email: string }>
  total: number
}

test.describe('TC-AUTH-026: signup anti-enumeration response contract', () => {
  test('returns 202 for both duplicate and fresh signup attempts while avoiding duplicate user creation', async ({ request }) => {
    const stamp = Date.now()
    const existingEmail = `qa-auth-026-existing-${stamp}@test.local`
    const freshEmail = `qa-auth-026-fresh-${stamp}@test.local`
    const existingPassword = `ExistingPass${stamp}!`
    const duplicateAttemptPassword = `DuplicatePass${stamp}!`
    const freshPassword = `FreshPass${stamp}!`

    let adminToken: string | null = null
    let existingUserId: string | null = null
    let freshUserId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const { tenantId, organizationId } = getTokenContext(adminToken)

      const createExistingRes = await apiRequest(request, 'POST', '/api/customer_accounts/admin/users', {
        token: adminToken,
        data: {
          email: existingEmail,
          password: existingPassword,
          displayName: `Existing User ${stamp}`,
        },
      })
      expect(createExistingRes.status(), 'fixture user should be created').toBe(201)
      const createdExistingBody = (await createExistingRes.json()) as { user?: { id?: string } }
      existingUserId = createdExistingBody.user?.id ?? null
      expect(existingUserId, 'fixture user id should be returned').toBeTruthy()

      const duplicateSignupRes = await request.post('/api/customer_accounts/signup', {
        data: {
          email: existingEmail,
          password: duplicateAttemptPassword,
          displayName: `Duplicate Probe ${stamp}`,
          tenantId,
          organizationId,
        },
        headers: { 'Content-Type': 'application/json' },
      })
      expect(duplicateSignupRes.status(), 'duplicate signup should be accepted').toBe(202)
      expect(await duplicateSignupRes.json()).toEqual({ ok: true })

      const freshSignupRes = await request.post('/api/customer_accounts/signup', {
        data: {
          email: freshEmail,
          password: freshPassword,
          displayName: `Fresh Signup ${stamp}`,
          tenantId,
          organizationId,
        },
        headers: { 'Content-Type': 'application/json' },
      })
      expect(freshSignupRes.status(), 'fresh signup should also be accepted').toBe(202)
      expect(await freshSignupRes.json()).toEqual({ ok: true })

      const existingListRes = await apiRequest(
        request,
        'GET',
        `/api/customer_accounts/admin/users?search=${encodeURIComponent(existingEmail)}&pageSize=100`,
        { token: adminToken },
      )
      expect(existingListRes.status(), 'admin search for existing email should succeed').toBe(200)
      const existingListBody = await readJsonSafe<AdminUsersResponse>(existingListRes)
      expect(existingListBody?.items.filter((item) => item.email === existingEmail)).toHaveLength(1)

      const freshListRes = await apiRequest(
        request,
        'GET',
        `/api/customer_accounts/admin/users?search=${encodeURIComponent(freshEmail)}&pageSize=100`,
        { token: adminToken },
      )
      expect(freshListRes.status(), 'admin search for fresh email should succeed').toBe(200)
      const freshListBody = await readJsonSafe<AdminUsersResponse>(freshListRes)
      const freshMatch = freshListBody?.items.find((item) => item.email === freshEmail) ?? null
      expect(freshMatch, 'fresh signup should create exactly one user').toBeTruthy()
      freshUserId = freshMatch?.id ?? null

      const originalLoginRes = await request.post('/api/customer_accounts/login', {
        data: { email: existingEmail, password: existingPassword, tenantId },
        headers: { 'Content-Type': 'application/json' },
      })
      expect(originalLoginRes.status(), 'existing user should still login with the original password').toBe(200)

      const duplicatePasswordLoginRes = await request.post('/api/customer_accounts/login', {
        data: { email: existingEmail, password: duplicateAttemptPassword, tenantId },
        headers: { 'Content-Type': 'application/json' },
      })
      expect(duplicatePasswordLoginRes.status(), 'duplicate signup must not replace the existing password').toBe(401)
    } finally {
      if (adminToken && freshUserId) {
        await apiRequest(request, 'DELETE', `/api/customer_accounts/admin/users/${freshUserId}`, { token: adminToken }).catch(() => {})
      }
      if (adminToken && existingUserId) {
        await apiRequest(request, 'DELETE', `/api/customer_accounts/admin/users/${existingUserId}`, { token: adminToken }).catch(() => {})
      }
    }
  })
})
