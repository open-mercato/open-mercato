import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { getAuthToken } from './helpers/api'
import { previewDocument } from './helpers/fixtures'

/**
 * TC-PDF-002: PDF preview endpoint
 *
 * Exercises POST /api/document-generators/preview across its documented contract:
 * a successful render streams an application/pdf response with a
 * Content-Disposition filename; missing fields and unknown templates return
 * 400; and the endpoint requires authentication.
 *
 * The happy path uses a random UUID as the record id — when no matching
 * quote/order exists the service returns the raw data and the pipeline still
 * renders a (near-empty) PDF, so the test does not depend on seeded data.
 * If the authenticated user has no active organization the route returns a
 * coded 409 (organization_required); both outcomes are accepted, mirroring the
 * environment-tolerant assertions used elsewhere in the integration suite.
 */
test.describe('TC-PDF-002: PDF preview', () => {
  test('should render a PDF for a built-in template', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await previewDocument(request, token, {
      template_id: 'order-invoice',
      data: { id: randomUUID() },
    })

    if (response.status() === 409) {
      // No active organization in this environment — the route guards the fetch.
      const body = await response.json()
      expect(body.error).toBe('organization_required')
      return
    }

    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('application/pdf')
    expect(response.headers()['content-disposition']).toMatch(/filename=".+\.pdf"/)

    const buffer = await response.body()
    // A valid PDF always starts with the "%PDF" magic bytes.
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF')
  })

  test('should return 400 when template_id or data is missing', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await previewDocument(request, token, { template_id: 'order-invoice' })

    expect(response.status()).toBe(400)
    const body = await response.json()
    expect(body.error).toBeTruthy()
  })

  test('should return 400 for an unknown template', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await previewDocument(request, token, {
      template_id: 'does-not-exist',
      data: { id: randomUUID() },
    })

    // 409 first if the environment has no active organization; otherwise 400.
    if (response.status() === 409) {
      expect((await response.json()).error).toBe('organization_required')
      return
    }
    expect(response.status()).toBe(400)
    expect((await response.json()).error).toContain('does-not-exist')
  })

  test('should reject an unauthenticated request', async ({ request }) => {
    const response = await request.post('/api/document-generators/preview', {
      data: { template_id: 'order-invoice', data: { id: randomUUID() } },
    })
    expect(response.ok()).toBe(false)
    expect([401, 403]).toContain(response.status())
  })
})
