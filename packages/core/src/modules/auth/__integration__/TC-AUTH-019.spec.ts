import { test, expect, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken, postForm } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenContext } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

test.describe('TC-AUTH-019: Self-service password change requires current password', () => {
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

  test('self-service password change succeeds with current password', async ({ request }) => {
    const testEmail = `qa-auth-019a-${stamp}@acme.com`
    const newPassword = 'Changed2@Secure'
    const userId = await createTestUser(request, testEmail)

    try {
      const userToken = await getAuthToken(request, testEmail, initialPassword)
      const changeRes = await apiRequest(request, 'PUT', '/api/auth/profile', {
        token: userToken,
        data: {
          email: testEmail,
          currentPassword: initialPassword,
          password: newPassword,
        },
      })

      expect(changeRes.status()).toBe(200)
      expect((await changeRes.json()).ok).toBe(true)

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

  test('self-service password change rejects missing current password', async ({ request }) => {
    const testEmail = `qa-auth-019b-${stamp}@acme.com`
    const newPassword = 'Another3@Safe'
    const userId = await createTestUser(request, testEmail)

    try {
      const userToken = await getAuthToken(request, testEmail, initialPassword)
      const changeRes = await apiRequest(request, 'PUT', '/api/auth/profile', {
        token: userToken,
        data: {
          email: testEmail,
          password: newPassword,
        },
      })

      expect(changeRes.status()).toBe(400)
      const body = await changeRes.json()
      expect(body.error).toBeTruthy()
      expect(Array.isArray(body.issues)).toBe(true)
      expect(body.issues.some((issue: { path?: string[] }) => issue.path?.includes('currentPassword'))).toBe(true)

      const loginWithOld = await postForm(request, '/api/auth/login', {
        email: testEmail,
        password: initialPassword,
      })
      expect(loginWithOld.status()).toBe(200)
      expect((await loginWithOld.json()).ok).toBe(true)
    } finally {
      await deleteTestUser(request, userId)
    }
  })

  test('self-service password change rejects incorrect current password', async ({ request }) => {
    const testEmail = `qa-auth-019c-${stamp}@acme.com`
    const newPassword = 'SafePass4@'
    const userId = await createTestUser(request, testEmail)

    try {
      const userToken = await getAuthToken(request, testEmail, initialPassword)
      const changeRes = await apiRequest(request, 'PUT', '/api/auth/profile', {
        token: userToken,
        data: {
          email: testEmail,
          currentPassword: 'Wrong1!Pass',
          password: newPassword,
        },
      })

      expect(changeRes.status()).toBe(400)
      const body = await changeRes.json()
      expect(typeof body.error).toBe('string')
      expect(Array.isArray(body.issues)).toBe(true)
      expect(body.issues.some((issue: { path?: string[] }) => issue.path?.includes('currentPassword'))).toBe(true)

      const loginWithOld = await postForm(request, '/api/auth/login', {
        email: testEmail,
        password: initialPassword,
      })
      expect(loginWithOld.status()).toBe(200)
      expect((await loginWithOld.json()).ok).toBe(true)

      const loginWithNew = await postForm(request, '/api/auth/login', {
        email: testEmail,
        password: newPassword,
      })
      expect(loginWithNew.status()).toBe(401)
      expect((await loginWithNew.json()).ok).toBe(false)
    } finally {
      await deleteTestUser(request, userId)
    }
  })
})
