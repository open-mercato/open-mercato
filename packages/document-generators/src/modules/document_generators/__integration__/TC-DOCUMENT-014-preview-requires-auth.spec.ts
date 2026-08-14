import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'

/**
 * TC-DOCUMENT-014: preview rendering is closed to anonymous callers.
 *
 * The preview route renders real records through a template, so an
 * unauthenticated POST must be rejected by the route guard before the
 * template registry is consulted. The body therefore names no registered
 * template — reaching template resolution at all would already be the defect.
 */
test.describe('TC-DOCUMENT-014: preview requires authentication', () => {
  test('rejects an anonymous preview request', async ({ request }) => {
    const response = await request.post('/api/document-generators/preview', {
      data: { template_id: `anonymous-probe-${randomUUID()}`, data: { id: randomUUID() } },
    })

    expect(response.ok(), 'anonymous preview must not render a document').toBe(false)
    expect([401, 403], 'anonymous preview should reject with 401 or 403').toContain(response.status())
  })
})
