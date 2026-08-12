import { expect, test } from '@playwright/test'
import { getAuthToken } from './helpers/api'
import { listTemplates } from './helpers/fixtures'

/**
 * TC-PDF-001: PDF templates endpoint lists the Sales-provided templates
 *
 * Calls GET /api/document-generators/templates and verifies the response is grouped
 * into { internal, external } and that the Sales templates — the Order
 * Invoice ('order-invoice') and the Sales Offer ('sales-offer') — are present
 * as module-provided templates with a well-formed metadata shape.
 */
test.describe('TC-PDF-001: PDF templates listing', () => {
  test('should return Sales templates grouped under external', async ({ request }) => {
    const token = await getAuthToken(request)
    const result = await listTemplates(request, token)

    expect(Array.isArray(result.internal)).toBe(true)
    expect(Array.isArray(result.external)).toBe(true)

    expect(result.internal).toEqual([])
    const externalIds = result.external.map((template) => template.id)
    expect(externalIds).toContain('order-invoice')
    expect(externalIds).toContain('order-invoice-markdown')
    expect(externalIds).toContain('sales-offer')

    const orderInvoice = result.external.find((template) => template.id === 'order-invoice')
    expect(orderInvoice).toBeDefined()
    expect(orderInvoice).toMatchObject({
      module: 'sales',
      resourceKind: 'sales.order',
      documentType: 'invoice',
      format: 'pdf',
    })
    expect(typeof orderInvoice?.label).toBe('string')
    expect(orderInvoice?.label.length).toBeGreaterThan(0)
    expect(Array.isArray(orderInvoice?.tags)).toBe(true)

    expect(result.external.find((template) => template.id === 'order-invoice-markdown')).toMatchObject({
      module: 'sales',
      resourceKind: 'sales.order',
      documentType: 'invoice',
      format: 'md',
    })

    const salesOffer = result.external.find((template) => template.id === 'sales-offer')
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
