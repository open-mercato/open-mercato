import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createSalesQuoteFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'
import {
  deleteGeneratedDocumentsForResource,
  generateDocument,
  listGeneratedDocuments,
  readJsonBody,
  requiredFeaturesOf,
} from '@open-mercato/document-generators/modules/document_generators/__integration__/helpers/document-generators-api'
import { withRestrictedDocumentUser } from './helpers/restricted-document-user'

/**
 * TC-DOCUMENT-012: generate refuses a template the caller may not use.
 *
 * Generate is the path that both hands out the file and writes history, so the
 * template requirement has to be enforced before either happens. The spec drives
 * the quote template — a different document service and a different required
 * feature than the preview case — and then confirms from the admin's own history
 * view that the refused call recorded nothing against the quote.
 */
test.describe('TC-DOCUMENT-012: template access forbids generate', () => {
  test('answers 403 with the required feature and writes no history', async ({ request }) => {
    test.slow()

    const adminToken = await getAuthToken(request, 'admin')
    let quoteId: string | null = null

    try {
      quoteId = await createSalesQuoteFixture(request, adminToken)

      await withRestrictedDocumentUser(request, { label: 'docs-generate-denied' }, async (token) => {
        const response = await generateDocument(request, token, {
          template_id: 'sales.offer',
          data: { id: quoteId },
        })

        expect(response.status(), 'a template requiring quote access should be refused').toBe(403)
        expect(response.headers()['content-type'], 'the refusal should be JSON, not a PDF stream')
          .toContain('application/json')

        const body = await readJsonBody(response)
        expect(body.error, 'the refusal should be reported as forbidden').toBe('forbidden')
        expect(body.message, 'the refusal should carry a translated message').toBeTruthy()
        expect(requiredFeaturesOf(body), 'the refusal should name the missing feature')
          .toContain('sales.quotes.view')
      })

      const history = await listGeneratedDocuments(request, adminToken, { resource_id: quoteId })
      expect(history.total, 'a refused generation must not be recorded in the history').toBe(0)
    } finally {
      await deleteGeneratedDocumentsForResource(quoteId)
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/quotes', quoteId)
    }
  })
})
