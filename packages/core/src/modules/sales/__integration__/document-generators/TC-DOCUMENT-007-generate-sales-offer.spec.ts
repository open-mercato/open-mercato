import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createSalesQuoteFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'
import {
  deleteGeneratedDocumentsForResource,
  generateDocument,
  isPdfStream,
} from '@open-mercato/document-generators/modules/document_generators/__integration__/helpers/document-generators-api'

/**
 * TC-DOCUMENT-007: generating a sales offer exercises the second resource kind.
 *
 * The offer runs through a different document service than the invoice — quotes
 * rather than orders — with its own data loader and its own filename builder.
 * Covering it separately keeps a regression in the quote path from hiding behind
 * a green order path, and pins the `offer-` prefix the user receives.
 */
test.describe('TC-DOCUMENT-007: generate a sales offer', () => {
  test('streams a PDF named after the offer template', async ({ request }) => {
    const token = await getAuthToken(request)
    let quoteId: string | null = null

    try {
      quoteId = await createSalesQuoteFixture(request, token)

      const response = await generateDocument(request, token, {
        template_id: 'sales.offer',
        data: { id: quoteId },
      })

      expect(response.status(), 'generating from an existing quote should succeed').toBe(200)
      expect(response.headers()['content-type'], 'the download should be a PDF')
        .toContain('application/pdf')
      expect(response.headers()['content-disposition'], 'the download should use the offer filename')
        .toMatch(/filename="offer-.+\.pdf"/)
      expect(isPdfStream(await response.body()), 'the body should be a real PDF document').toBe(true)
    } finally {
      await deleteGeneratedDocumentsForResource(quoteId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
    }
  })
})
