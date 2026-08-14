import { expect, test } from '@playwright/test'

/**
 * TC-DOCUMENT-016: generation history is closed to anonymous callers.
 *
 * History rows carry resource labels, template labels and the id of the user who
 * generated each document, and are scoped to the caller's active organization.
 * Without a session there is no organization to scope to, so the request must be
 * rejected rather than answered with an unscoped page.
 */
test.describe('TC-DOCUMENT-016: generation history requires authentication', () => {
  test('rejects an anonymous history request', async ({ request }) => {
    const response = await request.get('/api/document-generators/documents')

    expect(response.ok(), 'anonymous history must not be served').toBe(false)
    expect([401, 403], 'anonymous history should reject with 401 or 403').toContain(response.status())
  })
})
