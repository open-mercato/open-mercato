import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import * as dg from './helpers/document-generators-api'

test.describe('TC-DOCUMENT-017: preview rejects invalid request', () => {
  test('POST /preview answers invalid_request, unknown_template and invalid_json', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    await dg.readErrorEnvelope(await dg.previewDocument(request, token, { data: { id: dg.randomUuid() } }), 400, 'invalid_request')
    await dg.readErrorEnvelope(
      await dg.previewDocument(request, token, { template_id: dg.ORDER_PDF_TEMPLATE, data: { id: dg.randomUuid() }, extra: true }),
      400,
      'invalid_request',
    )
    await dg.readErrorEnvelope(
      await dg.previewDocument(request, token, { template_id: 'unregistered.template', data: { id: dg.randomUuid() } }),
      400,
      'unknown_template',
    )
    const malformed = await dg.previewDocument(request, token, '{not json')
    expect(malformed.status()).toBe(400)
    expect((await readJsonSafe<{ error?: string }>(malformed))?.error).toBe('invalid_json')
  })
})
