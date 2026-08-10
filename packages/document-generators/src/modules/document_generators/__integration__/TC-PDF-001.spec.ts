import { expect, test } from '@playwright/test'
import { getAuthToken } from './helpers/api'
import { listTemplates } from './helpers/fixtures'

/**
 * TC-PDF-001: PDF templates endpoint lists the built-in templates
 *
 * Calls GET /api/document-generators/templates and verifies the response is grouped
 * into { internal, external } and that both built-in templates — the Order
 * Invoice ('order-invoice') and the Sales Offer ('sales-offer') — are present
 * as internal templates with a well-formed metadata shape.
 */
test.describe('TC-PDF-001: PDF templates listing', () => {
  test('should return both built-in templates grouped under internal', async ({ request }) => {
    const token = await getAuthToken(request)
    const result = await listTemplates(request, token)

    expect(Array.isArray(result.internal)).toBe(true)
    expect(Array.isArray(result.external)).toBe(true)

    const internalIds = result.internal.map((t) => t.id)
    expect(internalIds).toContain('order-invoice')
    expect(internalIds).toContain('sales-offer')

    const orderInvoice = result.internal.find((t) => t.id === 'order-invoice')
    expect(orderInvoice).toBeDefined()
    expect(orderInvoice).toMatchObject({
      module: 'sales',
      resourceKind: 'sales.order',
      documentType: 'invoice',
    })
    expect(typeof orderInvoice?.label).toBe('string')
    expect(orderInvoice?.label.length).toBeGreaterThan(0)
    expect(Array.isArray(orderInvoice?.tags)).toBe(true)

    const salesOffer = result.internal.find((t) => t.id === 'sales-offer')
    expect(salesOffer).toMatchObject({
      module: 'sales',
      resourceKind: 'sales.quote',
      documentType: 'offer',
    })
  })

  test('should reject an unauthenticated request', async ({ request }) => {
    const response = await request.get('/api/document-generators/templates')
    expect(response.ok()).toBe(false)
    expect([401, 403]).toContain(response.status())
  })
})
