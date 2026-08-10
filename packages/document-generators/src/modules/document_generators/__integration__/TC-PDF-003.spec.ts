import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { getAuthToken } from './helpers/api'
import { generateDocument } from './helpers/fixtures'

/**
 * TC-PDF-003: PDF generate endpoint
 *
 * Exercises POST /api/document-generators/generate — the production download path.
 * A successful call streams an application/pdf response whose
 * Content-Disposition carries a template-appropriate filename; missing fields
 * and unknown templates return 400; and the endpoint requires authentication.
 *
 * As in TC-PDF-002 the happy path uses a random UUID so it does not depend on
 * seeded data (the service returns raw data when no record matches and the
 * pipeline still renders), and a 409 organization_required is accepted for
 * environments without an active organization.
 *
 * With a non-existent record the document number is absent, so the service's
 * filename() falls back to its per-template default — 'invoice.pdf' for
 * order-invoice, 'offer.pdf' for sales-offer — which this test asserts.
 */
test.describe('TC-PDF-003: PDF generate', () => {
  test('should generate an order-invoice PDF with the invoice filename', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await generateDocument(request, token, {
      template_id: 'order-invoice',
      data: { id: randomUUID() },
    })

    if (response.status() === 409) {
      expect((await response.json()).error).toBe('organization_required')
      return
    }

    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('application/pdf')
    expect(response.headers()['content-disposition']).toContain('filename="invoice.pdf"')

    const buffer = await response.body()
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF')
  })

  test('should generate a sales-offer PDF with the offer filename', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await generateDocument(request, token, {
      template_id: 'sales-offer',
      data: { id: randomUUID() },
    })

    if (response.status() === 409) {
      expect((await response.json()).error).toBe('organization_required')
      return
    }

    expect(response.status()).toBe(200)
    expect(response.headers()['content-disposition']).toContain('filename="offer.pdf"')
  })

  test('should return 400 when template_id or data is missing', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await generateDocument(request, token, { data: { id: randomUUID() } })

    expect(response.status()).toBe(400)
    expect((await response.json()).error).toBeTruthy()
  })

  test('should return 400 for an unknown template', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await generateDocument(request, token, {
      template_id: 'does-not-exist',
      data: { id: randomUUID() },
    })

    if (response.status() === 409) {
      expect((await response.json()).error).toBe('organization_required')
      return
    }
    expect(response.status()).toBe(400)
    expect((await response.json()).error).toContain('does-not-exist')
  })

  test('should reject an unauthenticated request', async ({ request }) => {
    const response = await request.post('/api/document-generators/generate', {
      data: { template_id: 'order-invoice', data: { id: randomUUID() } },
    })
    expect(response.ok()).toBe(false)
    expect([401, 403]).toContain(response.status())
  })
})
