import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCustomerUserFixture,
  deleteCustomerUserFixture,
  portalCookieHeaders,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'

/**
 * TC-PORTAL-006 [P1]: Portal session listing flags the current session, and
 * revocation deletes non-current sessions but protects the current one.
 *
 * Surfaces:
 *   - GET /api/customer_accounts/portal/sessions
 *   - DELETE /api/customer_accounts/portal/sessions/[id]
 * Source: issue #2463.
 *
 * No feature gate — any authenticated customer manages their own sessions.
 * Two logins of the same user create two independent sessions.
 */

type PortalSessionEntry = {
  id: string
  ipAddress: string | null
  userAgent: string | null
  lastUsedAt: string | null
  createdAt: string
  expiresAt: string
  isCurrent: boolean
}

type SessionsResponse = { ok: boolean; sessions?: PortalSessionEntry[] }
type OkResponse = { ok: boolean; error?: string }

test.describe('TC-PORTAL-006: portal session listing and revocation', () => {
  test('lists sessions, marks the current one, and guards current-session revocation', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)

    let userId: string | null = null

    try {
      // No auth → 401 (before any fixture).
      const anon = await request.get('/api/customer_accounts/portal/sessions')
      expect(anon.status(), 'sessions list should be 401 without auth').toBe(401)

      const user = await createCustomerUserFixture(request, adminToken, {})
      userId = user.id

      // Two independent logins → two active sessions for the same user.
      const sessionOne = await portalLogin(request, {
        email: user.email,
        password: user.password,
        tenantId,
      })
      const sessionTwo = await portalLogin(request, {
        email: user.email,
        password: user.password,
        tenantId,
      })

      const listRes = await request.get('/api/customer_accounts/portal/sessions', {
        headers: portalCookieHeaders(sessionOne),
      })
      expect(listRes.status()).toBe(200)
      const list = await readJsonSafe<SessionsResponse>(listRes)
      expect(list?.ok).toBe(true)
      expect(Array.isArray(list?.sessions)).toBe(true)
      expect(list!.sessions!.length, 'two logins → at least two sessions').toBeGreaterThanOrEqual(2)

      for (const entry of list!.sessions!) {
        expect(typeof entry.id).toBe('string')
        expect(typeof entry.createdAt).toBe('string')
        expect(typeof entry.expiresAt).toBe('string')
        expect(typeof entry.isCurrent).toBe('boolean')
        expect('ipAddress' in entry).toBe(true)
        expect('userAgent' in entry).toBe(true)
        expect('lastUsedAt' in entry).toBe(true)
      }

      const currentSessions = list!.sessions!.filter((s) => s.isCurrent)
      expect(currentSessions.length, 'exactly one session is current for this caller').toBe(1)
      const current = currentSessions[0]
      const other = list!.sessions!.find((s) => !s.isCurrent)
      expect(other, 'a non-current session should exist').toBeTruthy()

      // Revoke the non-current session → 200, and that session stops working.
      const revokeRes = await request.delete(`/api/customer_accounts/portal/sessions/${other!.id}`, {
        headers: portalCookieHeaders(sessionOne),
      })
      expect(revokeRes.status(), 'revoking a non-current session should be 200').toBe(200)
      expect((await readJsonSafe<OkResponse>(revokeRes))?.ok).toBe(true)

      const otherAfter = await request.get('/api/customer_accounts/portal/profile', {
        headers: portalCookieHeaders(sessionTwo),
      })
      expect(otherAfter.status(), 'revoked session can no longer authenticate').toBe(401)

      // Revoking a non-existent session → 404.
      const missingRes = await request.delete(`/api/customer_accounts/portal/sessions/${randomUUID()}`, {
        headers: portalCookieHeaders(sessionOne),
      })
      expect(missingRes.status(), 'unknown session should be 404').toBe(404)
      expect((await readJsonSafe<OkResponse>(missingRes))?.error).toBe('Session not found')

      // Revoking the current session is blocked → 400.
      const selfRevoke = await request.delete(`/api/customer_accounts/portal/sessions/${current.id}`, {
        headers: portalCookieHeaders(sessionOne),
      })
      expect(selfRevoke.status(), 'revoking the current session should be 400').toBe(400)
      expect((await readJsonSafe<OkResponse>(selfRevoke))?.error).toBe('Cannot revoke current session. Use logout instead.')
    } finally {
      await deleteCustomerUserFixture(request, adminToken, userId)
    }
  })
})
