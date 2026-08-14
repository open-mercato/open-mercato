import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { listTemplates } from '@open-mercato/document-generators/modules/document_generators/__integration__/helpers/document-generators-api'

/**
 * TC-DOCUMENT-001: Sales publishes its templates into the shared catalogue.
 *
 * Sales registers its document templates through the document_generators
 * registry rather than owning an endpoint of its own, so the catalogue is the
 * only place where that registration is observable end to end. The metadata
 * asserted here is what the templates list and the Documents tabs filter and
 * label by — a template that arrives without its resource kind, document type or
 * format is invisible to those screens even though the registration "worked".
 */
test.describe('TC-DOCUMENT-001: Sales templates in the catalogue', () => {
  test('lists the order invoice, its markdown variant and the sales offer', async ({ request }) => {
    const token = await getAuthToken(request)
    const templates = await listTemplates(request, token)

    expect(Array.isArray(templates), 'the catalogue should be an array').toBe(true)
    const templateIds = templates.map((template) => template.id)
    expect(templateIds, 'the order invoice should be registered').toContain('sales.order-invoice')
    expect(templateIds, 'the markdown invoice should be registered').toContain('sales.order-invoice-markdown')
    expect(templateIds, 'the sales offer should be registered').toContain('sales.offer')

    const orderInvoice = templates.find((template) => template.id === 'sales.order-invoice')
    expect(orderInvoice, 'the order invoice should be resolvable by id').toBeDefined()
    expect(orderInvoice, 'the order invoice should describe its resource and output').toMatchObject({
      module: 'sales',
      resourceKind: 'sales.order',
      documentType: 'invoice',
      format: 'pdf',
    })
    expect(typeof orderInvoice?.label, 'the label should be a resolved string, not a key object').toBe('string')
    expect(orderInvoice?.label.length, 'the label should be non-empty').toBeGreaterThan(0)
    expect(Array.isArray(orderInvoice?.tags), 'tags drive catalogue filtering').toBe(true)

    expect(
      templates.find((template) => template.id === 'sales.order-invoice-markdown'),
      'the markdown variant should share the invoice identity but differ in format',
    ).toMatchObject({
      module: 'sales',
      resourceKind: 'sales.order',
      documentType: 'invoice',
      format: 'md',
    })

    expect(
      templates.find((template) => template.id === 'sales.offer'),
      'the offer should be bound to quotes',
    ).toMatchObject({
      module: 'sales',
      resourceKind: 'sales.quote',
      documentType: 'offer',
    })
  })
})
