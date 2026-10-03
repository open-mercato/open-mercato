import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import * as dg from './helpers/document-generators-api'

test.describe('TC-DOCUMENT-003: preview order invoice', () => {
  test('POST /preview renders the order invoice PDF without writing history', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null
    try {
      orderId = await dg.createOrderWithLine(request, token)
      const response = await dg.previewDocument(request, token, { template_id: dg.ORDER_PDF_TEMPLATE, data: { id: orderId } })
      expect(response.status()).toBe(200)
      dg.expectDocumentHeaders(response, { contentType: /^application\/pdf/, extension: 'pdf' })
      await dg.expectPdfBody(response)
      const history = await dg.fetchResourceHistory(request, token, dg.ORDER_KIND, orderId)
      expect(history.items).toHaveLength(0)
    } finally {
      await dg.deleteOrder(request, token, orderId)
    }
  })

  test('POST /preview renders the Markdown order invoice', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null
    try {
      orderId = await dg.createOrderWithLine(request, token)
      const response = await dg.previewDocument(request, token, { template_id: dg.ORDER_MARKDOWN_TEMPLATE, data: { id: orderId } })
      expect(response.status()).toBe(200)
      dg.expectDocumentHeaders(response, { contentType: /^text\/markdown/, extension: 'md' })
      expect((await response.text()).length).toBeGreaterThan(0)
    } finally {
      await dg.deleteOrder(request, token, orderId)
    }
  })
})
