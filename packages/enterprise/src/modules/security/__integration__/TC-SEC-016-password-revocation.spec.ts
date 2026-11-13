import { randomBytes, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { hashAuthToken } from '@open-mercato/core/modules/auth/lib/tokenHash'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  createAdminApiToken,
  createUserFixture,
  deleteUserFixture,
  fetchJson,
} from './helpers/securityFixtures'

test.describe('TC-SEC-016: Password change revokes other credentials (#9143)', () => {
  test('retains the caller, revokes other sessions/resets, and isolates another user', async ({ request, playwright, baseURL }) => {
    const adminToken = await createAdminApiToken(request)
    const user = await createUserFixture(request, adminToken)
    let controlUserId: string | null = null
    const caller = await playwright.request.newContext({ baseURL })
    const other = await playwright.request.newContext({ baseURL })
    const control = await playwright.request.newContext({ baseURL })
    const resetToken = randomBytes(32).toString('hex')
    const controlResetToken = randomBytes(32).toString('hex')
    const newPassword = 'ChangedPass2!'

    try {
      const controlUser = await createUserFixture(request, adminToken)
      controlUserId = controlUser.id
      for (const [context, account] of [[caller, user], [other, user], [control, controlUser]] as const) {
        const login = await context.post('/api/auth/login', {
          form: { email: account.email, password: account.password, remember: 'true' },
        })
        expect(login.status()).toBe(200)
        expect((await login.json()).mfa_required).not.toBe(true)
      }
      const otherCookies = (await other.storageState()).cookies
      const otherAuth = otherCookies.find((cookie) => cookie.name === 'auth_token')!.value
      const otherSession = otherCookies.find((cookie) => cookie.name === 'session_token')!.value
      const callerSession = (await caller.storageState()).cookies.find((cookie) => cookie.name === 'session_token')!.value
      const controlSession = (await control.storageState()).cookies.find((cookie) => cookie.name === 'session_token')!.value
      const callerAuth = (await caller.storageState()).cookies.find((cookie) => cookie.name === 'auth_token')!.value
      const controlAuth = (await control.storageState()).cookies.find((cookie) => cookie.name === 'auth_token')!.value
      await withClient(async (client) => {
        for (const [userId, token] of [[user.id, resetToken], [controlUser.id, controlResetToken]]) {
          await client.query(
            "insert into password_resets (id, user_id, token, expires_at, created_at) values ($1, $2, $3, now() + interval '1 hour', now())",
            [randomUUID(), userId, hashAuthToken(token)],
          )
        }
      })
      expect((await (await request.post('/api/auth/reset/validate', { form: { token: resetToken } })).json()).valid).toBe(true)

      const rejected = await caller.put('/api/security/profile/password', {
        headers: { Authorization: `Bearer ${callerAuth}` },
        data: { currentPassword: 'WrongPass1!', newPassword },
      })
      expect(rejected.status()).toBe(401)
      expect((await (await request.post('/api/auth/reset/validate', { form: { token: resetToken } })).json()).valid).toBe(true)
      expect((await other.post('/api/auth/session/refresh', { data: { refreshToken: otherSession } })).status()).toBe(200)

      const changed = await caller.put('/api/security/profile/password', {
        headers: { Authorization: `Bearer ${callerAuth}` },
        data: { currentPassword: user.password, newPassword },
      })
      expect(changed.status()).toBe(200)
      expect(await changed.json()).toEqual({ ok: true })
      expect((await caller.get('/api/auth/profile', {
        headers: { Cookie: `auth_token=${callerAuth}; session_token=${callerSession}` },
      })).status()).toBe(200)
      expect((await caller.post('/api/auth/session/refresh', { data: { refreshToken: callerSession } })).status()).toBe(200)
      expect((await fetchJson(request, 'GET', '/api/auth/profile', { token: otherAuth })).status).toBe(401)
      expect((await request.post('/api/auth/session/refresh', {
        data: { refreshToken: otherSession },
      })).status()).toBe(401)
      expect((await fetchJson(request, 'GET', '/api/auth/profile', { token: controlAuth })).status).toBe(200)
      expect((await control.post('/api/auth/session/refresh', { data: { refreshToken: controlSession } })).status()).toBe(200)
      expect((await (await request.post('/api/auth/reset/validate', { form: { token: resetToken } })).json()).valid).toBe(false)
      expect((await request.post('/api/auth/reset/confirm', {
        form: { token: resetToken, password: 'ResetAttempt3!' },
      })).status()).toBe(400)
      expect((await (await request.post('/api/auth/reset/validate', { form: { token: controlResetToken } })).json()).valid).toBe(true)
      expect((await other.post('/api/auth/login', {
        form: { email: user.email, password: user.password },
      })).status()).toBe(401)
      expect((await other.post('/api/auth/login', {
        form: { email: user.email, password: newPassword },
      })).status()).toBe(200)
    } finally {
      await withClient(async (client) => {
        await client.query('delete from password_resets where user_id = any($1::uuid[])', [[user.id, controlUserId].filter(Boolean)])
      })
      await deleteUserFixture(request, adminToken, user.id)
      await deleteUserFixture(request, adminToken, controlUserId)
      await Promise.all([caller.dispose(), other.dispose(), control.dispose()])
    }
  })
})
