import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { ENTITY_TYPE, csvFilePart, readJson, uploadMultipart } from './helpers/syncExcel'

/**
 * TC-SX-003: Upload endpoint enforces the maximum upload size (413).
 *
 * Source: GitHub issue #2493 (sync_excel coverage expansion).
 *
 * The upload route rejects oversized uploads in two places
 * (`packages/core/src/modules/sync_excel/api/upload/route.ts`):
 *   - a `Content-Length` guard with a 1MB multipart overhead allowance, and
 *   - a per-file `file.size` guard against the resolved max upload bytes.
 * The default attachment max is 25MB (`resolveDefaultAttachmentMaxUploadBytes`,
 * overridable via `OM_ATTACHMENT_MAX_UPLOAD_MB`). A buffer comfortably above
 * 26MB trips at least one of the two guards regardless of whether the client
 * sends a `Content-Length` header. In practice Playwright sends a Content-Length
 * for a buffered multipart body, so the Content-Length guard is the branch
 * exercised here; either way the response is 413 with the same message.
 *
 * The exact-boundary "size == max => 200" case is intentionally omitted: it
 * would require uploading, parsing, encrypting and persisting a ~25MB
 * attachment for which the module exposes no delete endpoint, and risks the
 * 20s spec timeout. The high-value security boundary is the rejection path.
 */
test.describe('TC-SX-003: sync_excel upload size limit', () => {
  test('rejects uploads larger than the maximum upload size with 413', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    // 27MB > the 25MB file-size limit and > the 26MB content-length limit.
    const oversized = Buffer.alloc(27 * 1024 * 1024, 0x61)
    const response = await uploadMultipart(request, token, {
      entityType: ENTITY_TYPE,
      file: csvFilePart({ name: 'oversized.csv', mimeType: 'text/csv', content: oversized }),
    })

    expect(response.status()).toBe(413)
    const body = await readJson(response)
    expect(String(body.error)).toContain('exceeds the maximum upload size')
  })

  test('accepts a small CSV well under the limit', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await uploadMultipart(request, token, {
      entityType: ENTITY_TYPE,
      file: csvFilePart({ name: 'small.csv', content: 'Record Id,Lead Name\nsx-small,Within Limit\n' }),
    })

    expect(response.status()).toBe(200)
    expect(String((await readJson(response)).entityType)).toBe(ENTITY_TYPE)
  })
})
