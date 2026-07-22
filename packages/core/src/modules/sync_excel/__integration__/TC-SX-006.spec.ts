import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { ENTITY_TYPE, previewUpload, readJson, uploadSampleCsv } from './helpers/syncExcel'

/**
 * TC-SX-006: Preview endpoint query-parameter validation.
 *
 * Source: GitHub issue #2493 (sync_excel coverage expansion).
 *
 * `syncExcelPreviewQuerySchema` requires `uploadId` to be a UUID and makes
 * `entityType` an optional enum. A malformed uploadId or an out-of-enum
 * entityType fails query validation => 422 'Invalid query', before any lookup.
 * Omitting `entityType` is valid (the route falls back to the upload's stored
 * entityType). The optional-entityType case uses a real upload so it exercises
 * the success path rather than a not-found lookup.
 */
test.describe('TC-SX-006: sync_excel preview query validation', () => {
  let token: string
  let uploadId: string

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
    const upload = await uploadSampleCsv(request, token, 'sx-query')
    uploadId = String(upload.uploadId)
  })

  test('returns 422 for a malformed uploadId', async ({ request }) => {
    const response = await previewUpload(request, token, { uploadId: 'not-a-uuid', entityType: ENTITY_TYPE })

    expect(response.status()).toBe(422)
    expect(String((await readJson(response)).error)).toContain('Invalid query')
  })

  test('returns 422 for an unsupported entityType', async ({ request }) => {
    const response = await previewUpload(request, token, { uploadId, entityType: 'invalid.type' })

    expect(response.status()).toBe(422)
    expect(String((await readJson(response)).error)).toContain('Invalid query')
  })

  test('accepts a request without entityType (optional, falls back to the upload)', async ({ request }) => {
    const response = await previewUpload(request, token, { uploadId })

    expect(response.status()).toBe(200)
    expect(String((await readJson(response)).entityType)).toBe(ENTITY_TYPE)
  })
})
