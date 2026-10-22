import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import * as dg from './helpers/document-generators-api'

test.describe('TC-DOCUMENT-006: generate order invoice', () => {
  test('POST /generate returns the PDF with headers and persists a decrypted history row', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null
    try {
      orderId = await dg.createOrderWithLine(request, token)
      const response = await dg.generateDocument(request, token, { template_id: dg.ORDER_PDF_TEMPLATE, data: { id: orderId } })
      expect(response.status()).toBe(200)
      dg.expectDocumentHeaders(response, { contentType: /^application\/pdf/, extension: 'pdf' })
      await dg.expectPdfBody(response)

      const history = await dg.pollResourceHistory(request, token, dg.ORDER_KIND, orderId, 1)
      expect(history.total).toBe(1)
      expect(history.items[0]).toMatchObject({
        resourceKind: dg.ORDER_KIND,
        resourceId: orderId,
        templateId: dg.ORDER_PDF_TEMPLATE,
        format: 'pdf',
      })
      expect(history.items[0].resourceLabel.length).toBeGreaterThan(0)
    } finally {
      await dg.deleteOrder(request, token, orderId)
    }
  })

  test('POST /generate returns Markdown for the Markdown template', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null
    try {
      orderId = await dg.createOrderWithLine(request, token)
      const response = await dg.generateDocument(request, token, { template_id: dg.ORDER_MARKDOWN_TEMPLATE, data: { id: orderId } })
      expect(response.status()).toBe(200)
      dg.expectDocumentHeaders(response, { contentType: /^text\/markdown/, extension: 'md' })
      const history = await dg.pollResourceHistory(request, token, dg.ORDER_KIND, orderId, 1)
      expect(history.items[0]).toMatchObject({ templateId: dg.ORDER_MARKDOWN_TEMPLATE, format: 'md' })
    } finally {
      await dg.deleteOrder(request, token, orderId)
    }
  })
})
