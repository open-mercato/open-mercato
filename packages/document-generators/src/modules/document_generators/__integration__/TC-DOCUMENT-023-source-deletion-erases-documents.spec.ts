import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import * as dg from './helpers/document-generators-api'

test.describe('TC-DOCUMENT-023: deleting the source order erases its generated documents', () => {
  test('the stored file stops being served and the history label is anonymized', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null
    try {
      orderId = await dg.createOrderWithLine(request, token)
      const generated = await dg.generateDocument(request, token, { template_id: dg.ORDER_PDF_TEMPLATE, data: { id: orderId } })
      expect(generated.status()).toBe(200)

      const before = await dg.pollResourceHistory(request, token, dg.ORDER_KIND, orderId, 1)
      expect(before.items).toHaveLength(1)
      const row = before.items[0]
      expect(row.resourceLabel).not.toBe(orderId)
      expect(row.attachmentId).toBeTruthy()
      const stored = await dg.downloadStoredDocument(request, token, row.id)
      expect(stored.status()).toBe(200)
      await dg.expectPdfBody(stored)

      const deletedOrderId = orderId
      await dg.deleteOrder(request, token, deletedOrderId)
      orderId = null

      await expect.poll(async () => {
        const page = await dg.fetchResourceHistory(request, token, dg.ORDER_KIND, deletedOrderId)
        const erased = page.items.find((item) => item.id === row.id)
        return erased ? { resourceLabel: erased.resourceLabel, attachmentId: erased.attachmentId } : null
      }, { timeout: 20_000 }).toEqual({ resourceLabel: deletedOrderId, attachmentId: null })

      const afterErasure = await dg.downloadStoredDocument(request, token, row.id)
      await dg.readErrorEnvelope(afterErasure, 404, 'not_found')
    } finally {
      await dg.deleteOrder(request, token, orderId)
    }
  })
})
