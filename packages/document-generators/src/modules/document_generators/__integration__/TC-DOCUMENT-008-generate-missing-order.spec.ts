import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import * as dg from './helpers/document-generators-api'

test.describe('TC-DOCUMENT-008: generate missing order', () => {
  test('POST /generate answers 404 not_found and writes no history', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const missingId = dg.randomUuid()
    const response = await dg.generateDocument(request, token, { template_id: dg.ORDER_PDF_TEMPLATE, data: { id: missingId } })
    await dg.readErrorEnvelope(response, 404, 'not_found')
    const history = await dg.fetchResourceHistory(request, token, dg.ORDER_KIND, missingId)
    expect(history.items).toHaveLength(0)
  })
})
