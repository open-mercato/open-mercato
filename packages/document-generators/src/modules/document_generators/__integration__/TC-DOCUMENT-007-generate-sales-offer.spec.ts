import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import * as dg from './helpers/document-generators-api'

test.describe('TC-DOCUMENT-007: generate sales offer', () => {
  test('POST /generate renders the quote offer PDF and records history', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let quoteId: string | null = null
    try {
      quoteId = await dg.createQuote(request, token)
      const response = await dg.generateDocument(request, token, { template_id: dg.QUOTE_PDF_TEMPLATE, data: { id: quoteId } })
      expect(response.status()).toBe(200)
      dg.expectDocumentHeaders(response, { contentType: /^application\/pdf/, extension: 'pdf' })
      await dg.expectPdfBody(response)
      const history = await dg.pollResourceHistory(request, token, dg.QUOTE_KIND, quoteId, 1)
      expect(history.items[0]).toMatchObject({ resourceKind: dg.QUOTE_KIND, resourceId: quoteId, templateId: dg.QUOTE_PDF_TEMPLATE })
    } finally {
      await dg.deleteQuote(request, token, quoteId)
    }
  })
})
