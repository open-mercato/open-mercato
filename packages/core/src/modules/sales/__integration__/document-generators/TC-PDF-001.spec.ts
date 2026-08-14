import { expect, test } from '@playwright/test'
import { getAuthToken } from './helpers/api'
import { listTemplateFilterOptions, listTemplates } from './helpers/fixtures'

/**
 * TC-PDF-001: PDF templates endpoint lists the Sales-provided templates
 *
 * Calls GET /api/document-generators/templates and verifies that the Sales
 * templates — the Order
 * Invoice ('order-invoice') and the Sales Offer ('sales-offer') — are present
 * with a well-formed metadata shape.
 */
test.describe('TC-PDF-001: PDF templates listing', () => {
  test('should return Sales templates', async ({ request }) => {
    const token = await getAuthToken(request)
    const result = await listTemplates(request, token)

    expect(Array.isArray(result)).toBe(true)
    const templateIds = result.map((template) => template.id)
    expect(templateIds).toContain('order-invoice')
    expect(templateIds).toContain('order-invoice-markdown')
    expect(templateIds).toContain('sales-offer')

    const orderInvoice = result.find((template) => template.id === 'order-invoice')
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

    expect(result.find((template) => template.id === 'order-invoice-markdown')).toMatchObject({
      module: 'sales',
      resourceKind: 'sales.order',
      documentType: 'invoice',
      format: 'md',
    })

    const salesOffer = result.find((template) => template.id === 'sales-offer')
    expect(salesOffer).toMatchObject({
      module: 'sales',
      resourceKind: 'sales.quote',
      documentType: 'offer',
    })
  })

  test('should reject unauthenticated catalogue requests', async ({ request }) => {
    for (const path of [
      '/api/document-generators/templates',
      '/api/document-generators/templates/options',
    ]) {
      const response = await request.get(path)
      expect(response.ok()).toBe(false)
      expect([401, 403]).toContain(response.status())
    }
  })

  test('should return template filter options without template metadata', async ({ request }) => {
    const token = await getAuthToken(request)
    const options = await listTemplateFilterOptions(request, token)

    expect(options.resourceKinds).toContain('sales.order')
    expect(options.resourceKinds).toContain('sales.quote')
    expect(options.formats).toContain('pdf')
    expect(options.formats).toContain('md')
    expect(options.resourceKinds).toEqual([...new Set(options.resourceKinds)].sort())
    expect(options.formats).toEqual([...new Set(options.formats)].sort())
    expect(options).not.toHaveProperty('items')
    expect(options).not.toHaveProperty('templates')
  })
})
