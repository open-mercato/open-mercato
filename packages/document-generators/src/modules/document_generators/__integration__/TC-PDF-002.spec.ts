import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import {
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'
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
 * The happy path creates its own order fixture and removes it in finally.
 * A separate case verifies the response for an inaccessible record.
 */
test.describe('TC-PDF-002: PDF preview', () => {
  test('should render a PDF for a built-in template', async ({ request }) => {
    const token = await getAuthToken(request)
    let orderId: string | null = null

    try {
      orderId = await createSalesOrderFixture(request, token)
      const response = await previewDocument(request, token, {
        template_id: 'order-invoice',
        data: { id: orderId },
      })

      expect(response.status()).toBe(200)
      expect(response.headers()['content-type']).toContain('application/pdf')
      expect(response.headers()['content-disposition']).toMatch(/filename=".+\.pdf"/)

      const buffer = await response.body()
      expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF')
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('should return 500 when the source order does not exist', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await previewDocument(request, token, {
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
