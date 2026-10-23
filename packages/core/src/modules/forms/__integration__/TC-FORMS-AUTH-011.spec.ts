import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
  getAuthToken,
  withCredentialIsolatedRequest,
} from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-FORMS-AUTH-011: the admin routes reject an unauthenticated caller.
 *
 * This is the one case in the suite that exists to validate the harness itself.
 * The `request` fixture keeps a cookie jar and `/api/auth/login` sets
 * `auth_token` on it, so a call that merely omits the `Authorization` header
 * still carries the last logged-in session — the assertion would pass on a
 * replayed cookie and prove nothing. Every call below therefore issues from
 * `withCredentialIsolatedRequest`, a context that never saw a login.
 *
 * The first block deliberately logs in through the shared fixture first, so the
 * jar IS populated. If the isolation ever regresses, this spec fails rather than
 * quietly passing.
 */
test.describe('TC-FORMS-AUTH-011: unauthenticated admin access', () => {
  test('answers 401 with no credentials even after a login on the shared context', async ({ request }) => {
    // Populate the shared fixture's cookie jar — the trap this spec guards.
    await getAuthToken(request, 'admin')

    const someFormId = randomUUID()

    await withCredentialIsolatedRequest(async (anonymous) => {
      const listRes = await anonymous.get('/api/forms')
      expect(listRes.status(), 'GET /api/forms with no credentials must be 401').toBe(401)
      const listBody = await readJsonSafe<{ error?: string; items?: unknown[] }>(listRes)
      expect(listBody?.items, 'a 401 must not carry a form list').toBeUndefined()

      const createRes = await anonymous.post('/api/forms', {
        headers: { 'Content-Type': 'application/json' },
        data: {
          key: `qa_auth011_${randomUUID().slice(0, 8)}`,
          name: 'should never exist',
          defaultLocale: 'en',
          supportedLocales: ['en'],
        },
      })
      expect(createRes.status(), 'POST /api/forms with no credentials must be 401').toBe(401)
      const createBody = await readJsonSafe<{ id?: string }>(createRes)
      expect(createBody?.id, 'an unauthenticated create must not return an id').toBeFalsy()

      const detailRes = await anonymous.get(`/api/forms/${someFormId}`)
      expect(detailRes.status(), 'GET /api/forms/:id with no credentials must be 401, not 404').toBe(401)

      const patchRes = await anonymous.fetch(`/api/forms/${someFormId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        data: { name: 'nope' },
      })
      expect(patchRes.status(), 'PATCH /api/forms/:id with no credentials must be 401').toBe(401)

      const deleteRes = await anonymous.fetch(`/api/forms/${someFormId}`, { method: 'DELETE' })
      expect(deleteRes.status(), 'DELETE /api/forms/:id with no credentials must be 401').toBe(401)

      // A garbage bearer is an explicit failed attempt, not an anonymous one.
      const garbageRes = await anonymous.get('/api/forms', {
        headers: { Authorization: 'Bearer not-a-real-token' },
      })
      expect(garbageRes.status(), 'a malformed bearer must also be 401').toBe(401)
    })
  })
})
