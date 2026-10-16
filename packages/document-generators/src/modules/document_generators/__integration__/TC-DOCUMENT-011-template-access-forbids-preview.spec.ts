import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import * as dg from './helpers/document-generators-api'
import { createRestrictedDocumentUser, type RestrictedDocumentUser } from './helpers/restricted-document-user'

test.describe('TC-DOCUMENT-011: template access forbids preview', () => {
  let restricted: RestrictedDocumentUser | null = null

  test.afterAll(async () => {
    await restricted?.cleanup()
  })

  test('POST /preview answers 403 forbidden with requiredFeatures when the source feature is missing', async ({ request }) => {
    test.setTimeout(90_000)
    const adminToken = await getAuthToken(request, 'admin')
    let orderId: string | null = null
    try {
      orderId = await dg.createOrderWithLine(request, adminToken)
      restricted = await createRestrictedDocumentUser(request, { label: '011', sourceFeatures: ['sales.quotes.view'] })
      const response = await dg.previewDocument(request, restricted.token, { template_id: dg.ORDER_PDF_TEMPLATE, data: { id: orderId } })
      const envelope = await dg.readErrorEnvelope(response, 403, 'forbidden')
      expect(envelope.requiredFeatures).toContain('sales.orders.view')
      const history = await dg.fetchResourceHistory(request, adminToken, dg.ORDER_KIND, orderId)
      expect(history.items).toHaveLength(0)
    } finally {
      await dg.deleteOrder(request, adminToken, orderId)
    }
  })
})
