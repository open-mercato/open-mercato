import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { ENTITY_TYPE, previewUpload, readJson, uploadSampleCsv } from './helpers/syncExcel'

/**
 * TC-SX-005: Preview endpoint not-found and organization scoping.
 *
 * Source: GitHub issue #2493 (sync_excel coverage expansion).
 *
 * The preview route looks up the upload scoped by `organizationId` + `tenantId`
 * (`packages/core/src/modules/sync_excel/api/preview/route.ts`). A well-formed
 * but unknown id returns 404 (the original issue claimed 200 here — that is the
 * found case, not the missing case). Selecting "All organizations" (`__all__`)
 * is rejected before the lookup with 422, which exercises the org-scoping guard
 * without depending on a second seeded organization.
 */
test.describe('TC-SX-005: sync_excel preview not-found and scoping', () => {
  let token: string
  let uploadId: string

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
    const upload = await uploadSampleCsv(request, token, 'sx-preview')
    uploadId = String(upload.uploadId)
  })

  test('returns 404 for a well-formed but non-existent uploadId', async ({ request }) => {
    const response = await previewUpload(request, token, {
      uploadId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      entityType: ENTITY_TYPE,
    })

    expect(response.status()).toBe(404)
    expect(String((await readJson(response)).error)).toContain('Upload preview not found')
  })

  test('returns 200 for an existing upload within the active organization', async ({ request }) => {
    const response = await previewUpload(request, token, { uploadId, entityType: ENTITY_TYPE })

    expect(response.status()).toBe(200)
    const body = await readJson(response)
    expect(String(body.uploadId)).toBe(uploadId)
    expect(String(body.entityType)).toBe(ENTITY_TYPE)
  })

  test('rejects "All organizations" scope with 422 before the lookup', async ({ request }) => {
    const response = await previewUpload(request, token, { uploadId, entityType: ENTITY_TYPE }, '__all__')

    expect(response.status()).toBe(422)
    expect(String((await readJson(response)).error)).toContain('Select a concrete organization')
  })
})
