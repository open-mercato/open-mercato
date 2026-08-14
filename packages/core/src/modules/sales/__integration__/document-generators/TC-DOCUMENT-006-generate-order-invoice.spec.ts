import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'
import {
  deleteGeneratedDocumentsForResource,
  generateDocument,
  isPdfStream,
} from '@open-mercato/document-generators/modules/document_generators/__integration__/helpers/document-generators-api'

/**
 * TC-DOCUMENT-006: generating an order invoice produces the downloadable file.
 *
 * Generate is the production path behind the download button, so beyond a valid
 * PDF it must name the file the way the Sales template dictates: the invoice
 * filename builder prefixes `invoice-`, and that prefix is what the user ends up
 * with on disk. A template whose filename builder regressed would still stream a
 * perfectly valid document.
 *
 * The order and the history row it creates are both removed in `finally`.
 */
test.describe('TC-DOCUMENT-006: generate an order invoice', () => {
  test('streams a PDF named after the invoice template', async ({ request }) => {
    const token = await getAuthToken(request)
    let orderId: string | null = null

    try {
      orderId = await createSalesOrderFixture(request, token)

      const response = await generateDocument(request, token, {
        template_id: 'sales.order-invoice',
        data: { id: orderId },
      })

      expect(response.status(), 'generating from an existing order should succeed').toBe(200)
      expect(response.headers()['content-type'], 'the download should be a PDF')
        .toContain('application/pdf')
      expect(response.headers()['content-disposition'], 'the download should use the invoice filename')
        .toMatch(/filename="invoice-.+\.pdf"/)
      expect(isPdfStream(await response.body()), 'the body should be a real PDF document').toBe(true)
    } finally {
      await deleteGeneratedDocumentsForResource(orderId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
})
