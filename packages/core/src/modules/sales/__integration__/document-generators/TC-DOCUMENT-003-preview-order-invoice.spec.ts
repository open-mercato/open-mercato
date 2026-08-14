import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'
import {
  isPdfStream,
  previewDocument,
} from '@open-mercato/document-generators/modules/document_generators/__integration__/helpers/document-generators-api'

/**
 * TC-DOCUMENT-003: previewing an order invoice renders a real PDF.
 *
 * This is the Documents tab path on the order detail page: the client sends only
 * the order id, and the Sales document service loads the order, normalizes it and
 * hands it to the react-pdf template. Asserting the `%PDF` magic bytes rather
 * than just a 200 is deliberate — a broken template or a renderer that silently
 * produced an empty buffer would still answer 200 with a PDF content type.
 *
 * The order is created through the API and deleted in `finally`, so the spec
 * depends on no seeded data.
 */
test.describe('TC-DOCUMENT-003: preview an order invoice', () => {
  test('streams a PDF rendered from a freshly created order', async ({ request }) => {
    const token = await getAuthToken(request)
    let orderId: string | null = null

    try {
      orderId = await createSalesOrderFixture(request, token)

      const response = await previewDocument(request, token, {
        template_id: 'sales.order-invoice',
        data: { id: orderId },
      })

      expect(response.status(), 'preview of an existing order should succeed').toBe(200)
      expect(response.headers()['content-type'], 'preview should be served as a PDF')
        .toContain('application/pdf')
      expect(response.headers()['content-disposition'], 'preview should name the file')
        .toMatch(/filename=".+\.pdf"/)
      expect(isPdfStream(await response.body()), 'the body should be a real PDF document').toBe(true)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
})
