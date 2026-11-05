import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { ENTITY_TYPE, csvFilePart, readJson, uploadMultipart } from './helpers/syncExcel'

/**
 * TC-SX-004: Upload endpoint validates the multipart payload fields.
 *
 * Source: GitHub issue #2493 (sync_excel coverage expansion).
 *
 * Upload route validation order
 * (`packages/core/src/modules/sync_excel/api/upload/route.ts`):
 *   - `entityType` is parsed first and defaults to `customers.person`;
 *     an unknown value fails the enum => 422 'Invalid upload payload.'
 *   - the `file` part must be an actual File => otherwise 400
 *     'Select a CSV file to upload.'
 */
test.describe('TC-SX-004: sync_excel upload field validation', () => {
  test('returns 400 when the file part is missing', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await uploadMultipart(request, token, { entityType: ENTITY_TYPE })

    expect(response.status()).toBe(400)
    expect(String((await readJson(response)).error)).toContain('Select a CSV file to upload')
  })

  test('returns 400 when the file field is a non-file value', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await uploadMultipart(request, token, { entityType: ENTITY_TYPE, file: '' })

    expect(response.status()).toBe(400)
    expect(String((await readJson(response)).error)).toContain('Select a CSV file to upload')
  })

  test('defaults entityType to customers.person when omitted', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await uploadMultipart(request, token, {
      file: csvFilePart({ name: 'defaulted.csv', content: 'Record Id,Lead Name\nsx-default,Default Entity\n' }),
    })

    expect(response.status()).toBe(200)
    expect(String((await readJson(response)).entityType)).toBe(ENTITY_TYPE)
  })

  test('returns 422 for an unsupported entityType value', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await uploadMultipart(request, token, {
      entityType: 'customers.company',
      file: csvFilePart({ name: 'invalid-entity.csv' }),
    })

    expect(response.status()).toBe(422)
    expect(String((await readJson(response)).error)).toContain('Invalid upload payload')
  })
})
