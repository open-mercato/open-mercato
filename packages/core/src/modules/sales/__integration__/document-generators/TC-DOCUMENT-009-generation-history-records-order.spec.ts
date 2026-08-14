import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'
import {
  deleteGeneratedDocumentsForResource,
  generateDocument,
  listGeneratedDocuments,
} from '@open-mercato/document-generators/modules/document_generators/__integration__/helpers/document-generators-api'

/**
 * TC-DOCUMENT-009: a generated invoice is recorded against its source order.
 *
 * This is the cross-module contract between Sales and document_generators: the
 * client posts nothing but a template id and an order id, and the server derives
 * the resource identity from the loaded template — kind, id and a human label.
 * The label assertion is the point of the test. A row that echoes the raw uuid
 * back means the derivation fell through to its fallback, which the history
 * screen would render as an unreadable identifier.
 *
 * The filtered second read covers the query surface the history screen actually
 * issues: narrowing by template, by author and by a generation window.
 */
test.describe('TC-DOCUMENT-009: generation history for an order invoice', () => {
  test('records server-derived resource identity and answers the history filters', async ({ request }) => {
    const token = await getAuthToken(request)
    let orderId: string | null = null

    try {
      orderId = await createSalesOrderFixture(request, token)

      const generated = await generateDocument(request, token, {
        template_id: 'sales.order-invoice',
        data: { id: orderId },
      })
      expect(generated.status(), 'the document must be generated before it can be recorded').toBe(200)

      const history = await listGeneratedDocuments(request, token, { resource_id: orderId })
      expect(history.total, 'the generation should be recorded').toBeGreaterThanOrEqual(1)

      const row = history.items.find((item) => item.resourceId === orderId)
      expect(row, 'the history should contain a row for the generated order').toBeDefined()
      expect(row?.resourceKind, 'the resource kind should come from the Sales template').toBe('sales.order')
      expect(row?.templateId, 'the row should name the template used').toBe('sales.order-invoice')
      expect(row?.resourceLabel, 'the row should carry a human-readable resource label').toBeTruthy()
      expect(row?.resourceLabel, 'the label should be derived, not a fallback to the raw id').not.toBe(orderId)
      expect(typeof row?.templateLabel, 'the template label should be a resolved string').toBe('string')
      expect(row?.templateLabel.length, 'the template label should be non-empty').toBeGreaterThan(0)
      expect(row?.generatedAt, 'the row should be timestamped').toBeTruthy()

      const filtered = await listGeneratedDocuments(request, token, {
        template_id: 'sales.order-invoice',
        generated_by: row!.generatedBy,
        generated_from: new Date(Date.now() - 60_000).toISOString(),
        generated_to: new Date(Date.now() + 60_000).toISOString(),
        sort: 'template_label',
        sort_direction: 'asc',
      })
      expect(
        filtered.items.some((item) => item.resourceId === orderId),
        'the row should survive filtering by template, author and generation window',
      ).toBe(true)
    } finally {
      await deleteGeneratedDocumentsForResource(orderId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
})
