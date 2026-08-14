import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'

/**
 * TC-DOCUMENT-015: production generation is closed to anonymous callers.
 *
 * Generate is the side-effecting path — it renders, persists a history row and
 * streams a download. An unauthenticated POST must be rejected by the
 * `document_generators.documents.generate` guard, leaving no history behind.
 */
test.describe('TC-DOCUMENT-015: generate requires authentication', () => {
  test('rejects an anonymous generate request', async ({ request }) => {
    const response = await request.post('/api/document-generators/generate', {
      data: { template_id: `anonymous-probe-${randomUUID()}`, data: { id: randomUUID() } },
    })

    expect(response.ok(), 'anonymous generate must not produce a document').toBe(false)
    expect([401, 403], 'anonymous generate should reject with 401 or 403').toContain(response.status())
  })
})
