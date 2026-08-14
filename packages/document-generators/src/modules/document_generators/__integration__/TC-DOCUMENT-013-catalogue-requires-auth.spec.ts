import { expect, test } from '@playwright/test'

/**
 * TC-DOCUMENT-013: the template catalogue is closed to anonymous callers.
 *
 * Both catalogue endpoints are declared with `requireAuth: true` and the
 * `document_generators.documents.view` feature, so a request carrying no
 * session must be rejected before any template metadata is serialized —
 * template ids, labels and notes describe the tenant's document surface.
 */
test.describe('TC-DOCUMENT-013: template catalogue requires authentication', () => {
  test('rejects anonymous requests to the catalogue endpoints', async ({ request }) => {
    for (const path of [
      '/api/document-generators/templates',
      '/api/document-generators/templates/options',
    ]) {
      const response = await request.get(path)

      expect(response.ok(), `${path} must not answer an anonymous caller`).toBe(false)
      expect([401, 403], `${path} should reject with 401 or 403`).toContain(response.status())
    }
  })
})
