import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import {
  createSalesOrderFixture,
  createSalesQuoteFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'
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
 * Each happy path creates and removes its own sales fixture. A separate case
 * verifies the response for an inaccessible source record.
 */
test.describe('TC-PDF-003: PDF generate', () => {
  test('should generate an order-invoice PDF with the invoice filename', async ({ request }) => {
    const token = await getAuthToken(request)
    let orderId: string | null = null

    try {
      orderId = await createSalesOrderFixture(request, token)
      const response = await generateDocument(request, token, {
        template_id: 'order-invoice',
        data: { id: orderId },
      })

      expect(response.status()).toBe(200)
      expect(response.headers()['content-type']).toContain('application/pdf')
      expect(response.headers()['content-disposition']).toMatch(/filename="invoice-.+\.pdf"/)

      const buffer = await response.body()
      expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF')
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('should generate a sales-offer PDF with the offer filename', async ({ request }) => {
    const token = await getAuthToken(request)
    let quoteId: string | null = null

    try {
      quoteId = await createSalesQuoteFixture(request, token)
      const response = await generateDocument(request, token, {
        template_id: 'sales-offer',
        data: { id: quoteId },
      })

      expect(response.status()).toBe(200)
      expect(response.headers()['content-type']).toContain('application/pdf')
      expect(response.headers()['content-disposition']).toMatch(/filename="offer-.+\.pdf"/)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
    }
  })

  test('should return 500 when the source order does not exist', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await generateDocument(request, token, {
      template_id: 'order-invoice',
      data: { id: randomUUID() },
    })

    expect(response.status()).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Failed to render document',
    })
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
