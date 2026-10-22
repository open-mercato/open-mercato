import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import * as dg from './helpers/document-generators-api'

test.describe('TC-DOCUMENT-004: preview missing order', () => {
  test('POST /preview answers 404 not_found for a nonexistent order and 400 for a non-UUID id', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const missing = await dg.previewDocument(request, token, { template_id: dg.ORDER_PDF_TEMPLATE, data: { id: dg.randomUuid() } })
    await dg.readErrorEnvelope(missing, 404, 'not_found')
    const malformed = await dg.previewDocument(request, token, { template_id: dg.ORDER_PDF_TEMPLATE, data: { id: 'not-a-uuid' } })
    await dg.readErrorEnvelope(malformed, 400, 'invalid_request')
  })
})
