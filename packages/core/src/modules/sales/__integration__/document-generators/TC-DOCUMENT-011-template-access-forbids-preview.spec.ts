import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'
import {
  previewDocument,
  readJsonBody,
  requiredFeaturesOf,
} from '@open-mercato/document-generators/modules/document_generators/__integration__/helpers/document-generators-api'
import { withRestrictedDocumentUser } from './helpers/restricted-document-user'

/**
 * TC-DOCUMENT-011: preview refuses a template the caller may not use.
 *
 * Hiding a template from the catalogue is not enough — the template id is a
 * guessable string and preview accepts it directly. A caller who holds
 * `document_generators.documents.view` but no Sales features must be refused at
 * the template's own requirement, not at the route guard, and the refusal must
 * be a 403 naming the missing feature so the UI can explain it.
 *
 * The order really exists and is reachable to an admin, which is what makes the
 * refusal attributable to the feature check rather than to a failed load.
 */
test.describe('TC-DOCUMENT-011: template access forbids preview', () => {
  test('answers 403 with the required feature for an unauthorized template', async ({ request }) => {
    test.slow()

    const adminToken = await getAuthToken(request, 'admin')
    let orderId: string | null = null

    try {
      orderId = await createSalesOrderFixture(request, adminToken)

      await withRestrictedDocumentUser(request, { label: 'docs-preview-denied' }, async (token) => {
        const response = await previewDocument(request, token, {
          template_id: 'sales.order-invoice',
          data: { id: orderId },
        })

        expect(response.status(), 'a template requiring Sales access should be refused').toBe(403)
        expect(response.headers()['content-type'], 'the refusal should be JSON, not a PDF stream')
          .toContain('application/json')

        const body = await readJsonBody(response)
        expect(body.error, 'the refusal should be reported as forbidden').toBe('forbidden')
        expect(body.message, 'the refusal should carry a translated message').toBeTruthy()
        expect(requiredFeaturesOf(body), 'the refusal should name the missing feature')
          .toContain('sales.orders.view')
      })
    } finally {
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/orders', orderId)
    }
  })
})
