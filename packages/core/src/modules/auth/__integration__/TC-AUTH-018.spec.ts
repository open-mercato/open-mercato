import { test, expect, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken, postForm } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenContext } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

/**
 * TC-AUTH-018: Password Change & Session Invalidation
 *
 * Verifies that after an employee's password is changed:
 * - The new password grants access
 * - The old password is rejected
 * - Existing refresh tokens (sessions) are invalidated
 */
test.describe('TC-AUTH-018: Password Change & Session Invalidation', () => {
  const stamp = Date.now()
  const initialPassword = 'Valid1!Pass'

  let adminToken: string | null = null
  let organizationId: string | null = null

  test.beforeAll(async ({ request }) => {
    adminToken = await getAuthToken(request)
    const ctx = getTokenContext(adminToken)
    organizationId = ctx.organizationId
  })

  async function createTestUser(request: APIRequestContext, email: string) {
    const res = await apiRequest(request, 'POST', '/api/auth/users', {
      token: adminToken!,
      data: { email, password: initialPassword, organizationId, roles: ['employee'] },
    })
    expect(res.status()).toBe(201)
    return ((await res.json()) as { id: string }).id
  }

  async function deleteTestUser(request: APIRequestContext, userId: string) {
    await apiRequest(request, 'DELETE', `/api/auth/users?id=${encodeURIComponent(userId)}`, {
      token: adminToken!,
    }).catch(() => undefined)
  }

  test('new password works and old password is rejected after change', async ({ request }) => {
    const testEmail = `qa-auth-018a-${stamp}@acme.com`
    const newPassword = 'Changed2@Secure'
    const userId = await createTestUser(request, testEmail)

    try {
      const loginBefore = await postForm(request, '/api/auth/login', {
        email: testEmail,
        password: initialPassword,
      })
      expect(loginBefore.status()).toBe(200)
      expect((await loginBefore.json()).ok).toBe(true)

      const changeRes = await apiRequest(request, 'PUT', '/api/auth/users', {
        token: adminToken!,
        data: { id: userId, password: newPassword },
      })
      expect(changeRes.status()).toBe(200)

      const loginWithNew = await postForm(request, '/api/auth/login', {
        email: testEmail,
        password: newPassword,
      })
      expect(loginWithNew.status()).toBe(200)
      expect((await loginWithNew.json()).ok).toBe(true)

      const loginWithOld = await postForm(request, '/api/auth/login', {
        email: testEmail,
        password: initialPassword,
      })
      expect(loginWithOld.status()).toBe(401)
      expect((await loginWithOld.json()).ok).toBe(false)
    } finally {
      await deleteTestUser(request, userId)
    }
  })

  test('refresh token is invalidated after password change', async ({ request }) => {
    const testEmail = `qa-auth-018b-${stamp}@acme.com`
    const newPassword = 'Another3#Safe'
    const userId = await createTestUser(request, testEmail)

    try {
      const loginRes = await postForm(request, '/api/auth/login', {
        email: testEmail,
        password: initialPassword,
        remember: '1',
      })
      expect(loginRes.status()).toBe(200)
      const loginBody = await loginRes.json()
      expect(loginBody.refreshToken).toBeTruthy()
      const { refreshToken } = loginBody

      const changeRes = await apiRequest(request, 'PUT', '/api/auth/users', {
        token: adminToken!,
        data: { id: userId, password: newPassword },
      })
      expect(changeRes.status()).toBe(200)

      const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
      const refreshRes = await request.post(`${BASE_URL}/api/auth/session/refresh`, {
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ refreshToken }),
      })
      expect(refreshRes.status()).toBe(401)
      expect((await refreshRes.json()).ok).toBe(false)

      const loginFinal = await postForm(request, '/api/auth/login', {
        email: testEmail,
        password: newPassword,
      })
      expect(loginFinal.status()).toBe(200)
      expect((await loginFinal.json()).ok).toBe(true)
    } finally {
      await deleteTestUser(request, userId)
    }
  })
})
