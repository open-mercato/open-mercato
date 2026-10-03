import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import * as dg from './helpers/document-generators-api'

test.describe('TC-DOCUMENT-009: generation history records order', () => {
  test('a successful generate adds a scoped row visible with both resource filters only', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null
    let otherOrderId: string | null = null
    try {
      orderId = await dg.createOrderWithLine(request, token)
      otherOrderId = await dg.createOrderWithLine(request, token)
      const generated = await dg.generateDocument(request, token, { template_id: dg.ORDER_PDF_TEMPLATE, data: { id: orderId } })
      expect(generated.status()).toBe(200)

      const scoped = await dg.pollResourceHistory(request, token, dg.ORDER_KIND, orderId, 1)
      expect(scoped.items.map((row) => row.resourceId)).toEqual([orderId])
      expect(scoped.items[0].templateId).toBe(dg.ORDER_PDF_TEMPLATE)

      const other = await dg.fetchResourceHistory(request, token, dg.ORDER_KIND, otherOrderId)
      expect(other.items).toHaveLength(0)

      const byTemplate = await dg.readHistoryPage(await dg.listDocuments(request, token, { template_id: dg.ORDER_PDF_TEMPLATE, resource_kind: dg.ORDER_KIND, resource_id: orderId }))
      expect(byTemplate.total).toBe(1)

      const onlyKind = await dg.listDocuments(request, token, { resource_kind: dg.ORDER_KIND })
      await dg.readErrorEnvelope(onlyKind, 400, 'invalid_query')
    } finally {
      await dg.deleteOrder(request, token, orderId)
      await dg.deleteOrder(request, token, otherOrderId)
    }
  })
})
