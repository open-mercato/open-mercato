import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteFormIfExists } from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-CRUD-004: malformed form keys are rejected as client errors.
 *
 * `formKeySchema` is `min(3).max(64).regex(/^[a-z][a-z0-9_-]*$/)`. The route
 * validates with a bare `schema.parse(...)`, so the assertion that matters is
 * "4xx and not 5xx": a route-layer ZodError leaking as `500
 * forms.errors.internal` is the regression this guards (a caller could not tell
 * its own bad request from a server fault). Asserting the literal 500 would pin
 * that bug; asserting a literal 400 would couple to the error shape.
 */
const INVALID_KEYS: Array<{ key: string; why: string }> = [
  { key: 'A-bad key', why: 'uppercase and a space' },
  { key: 'ab', why: 'shorter than 3 characters' },
  { key: 'x'.repeat(65), why: 'longer than 64 characters' },
  { key: '1leading_digit', why: 'does not start with a lowercase letter' },
]

test.describe('TC-FORMS-CRUD-004: invalid form key shapes', () => {
  test('rejects every malformed key as a client error and creates nothing', async ({ request }) => {
    let adminToken: string | null = null
    const createdIds: string[] = []

    try {
      adminToken = await getAuthToken(request, 'admin')

      for (const { key, why } of INVALID_KEYS) {
        const response = await apiRequest(request, 'POST', '/api/forms', {
          token: adminToken,
          data: { key, name: 'QA CRUD004', defaultLocale: 'en', supportedLocales: ['en'] },
        })
        const body = await readJsonSafe<{ id?: string; error?: string }>(response)
        if (typeof body?.id === 'string' && body.id.length > 0) createdIds.push(body.id)

        expect(
          response.status(),
          `key rejected for ${why} should be a 4xx (got ${response.status()}: ${JSON.stringify(body)})`,
        ).toBeGreaterThanOrEqual(400)
        expect(
          response.status(),
          `key rejected for ${why} must not surface as a server fault (got ${response.status()})`,
        ).toBeLessThan(500)
        expect(body?.error, `key rejected for ${why} should name an error`).toBeTruthy()
        expect(body?.id, `key rejected for ${why} must not create a form`).toBeFalsy()
      }
    } finally {
      for (const id of createdIds) {
        await deleteFormIfExists(request, adminToken, id)
      }
    }
  })
})
