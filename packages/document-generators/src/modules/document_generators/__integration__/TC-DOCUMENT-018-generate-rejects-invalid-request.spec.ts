import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import * as dg from './helpers/document-generators-api'

test.describe('TC-DOCUMENT-018: generate rejects invalid request', () => {
  test('POST /generate answers invalid_request and unknown_template without writing history', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const before = await dg.readHistoryPage(await dg.listDocuments(request, token, { pageSize: 1 }))
    await dg.readErrorEnvelope(await dg.generateDocument(request, token, { data: { id: dg.randomUuid() } }), 400, 'invalid_request')
    await dg.readErrorEnvelope(
      await dg.generateDocument(request, token, { template_id: 'unregistered.template', data: { id: dg.randomUuid() } }),
      400,
      'unknown_template',
    )
    const after = await dg.readHistoryPage(await dg.listDocuments(request, token, { pageSize: 1 }))
    expect(after.total).toBe(before.total)
  })
})
