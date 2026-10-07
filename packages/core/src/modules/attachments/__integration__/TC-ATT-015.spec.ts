import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { expect, test } from '@playwright/test'
import { bootstrapFromAppRoot } from '@open-mercato/shared/lib/bootstrap/dynamicLoader'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenScope } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { deleteAttachmentIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import type { AttachmentService } from '@open-mercato/core/modules/attachments'

/**
 * TC-ATT-015: a vector image stored through the scoped upload path is served
 * inline as SVG with the vector Content-Security-Policy over real HTTP, and an
 * SVG-typed row without a valid vector record stays a download.
 *
 * No HTTP endpoint stores a vector image — only module code calling
 * `attachmentService.createScoped({ allowVectorImage: true })` does — so the
 * upload runs in this process against the app's database and storage root,
 * the same way TC-CRM-028 drives server code. The serving half is plain HTTP
 * against the running app. `next.config.ts` gives responses whose raw path
 * starts with `/api/attachments/file/` one sandboxing CSP (`FILE_PATH_CSP`),
 * which Next.js keeps over the route's own header, so downloads and errors
 * carry it too; the inline SVG is the response that needs its style and data:
 * allowances. Percent-encoded spellings of the path reach the route without
 * matching that rule, so the route serves the SVG inline only on the canonical
 * path and this test checks that the encoded spellings never get inline SVG.
 */

const TEST_APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim()
const IS_STANDALONE_APP = Boolean(TEST_APP_ROOT)
const APP_ROOT = TEST_APP_ROOT ? path.resolve(TEST_APP_ROOT) : path.resolve(process.cwd(), 'apps/mercato')
const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'
const VECTOR_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox"
const FILE_PATH_CSP = VECTOR_CSP

const LOGO = `<?xml version="1.0" encoding="UTF-8"?>
<!-- exported by a vector editor -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40">
  <style>.mark{fill:url(#brand)}</style>
  <defs><linearGradient id="brand"><stop offset="0" stop-color="#e63946"/><stop offset="1" stop-color="#457b9d"/></linearGradient></defs>
  <rect class="mark" width="40" height="40" rx="8"/>
  <text x="50" y="26" font-family="sans-serif" font-size="16">Brand</text>
</svg>`

if (!IS_STANDALONE_APP) {
  loadEnv({ path: path.resolve(APP_ROOT, '.env') })
  if (!process.env.ATTACHMENTS_STORAGE_ROOT?.trim()) {
    process.env.ATTACHMENTS_STORAGE_ROOT = path.resolve(APP_ROOT, 'storage', 'attachments')
  }
}

async function resolveAttachmentService(): Promise<AttachmentService> {
  await bootstrapFromAppRoot(APP_ROOT)
  const container = await createRequestContainer()
  return container.resolve('attachmentService') as AttachmentService
}

test.describe('TC-ATT-015: sanitised vector images over HTTP', () => {
  test.describe.configure({ timeout: 120_000 })

  test.beforeAll(() => {
    test.skip(IS_STANDALONE_APP, 'Drives the scoped upload service in-process; monorepo only, like TC-CRM-028')
  })

  test('serves a sanitised vector image inline with the vector CSP and keeps other SVG rows as downloads', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenScope(adminToken)
    const recordId = `qa-att-015-${Date.now()}`
    const attachmentService = await resolveAttachmentService()
    let attachmentId: string | null = null

    try {
      await expect(attachmentService.createScoped({
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        entityId: 'attachments:library',
        recordId,
        partitionCode: 'privateAttachments',
        fileName: 'brand.svg',
        declaredMimeType: 'image/svg+xml',
        buffer: Buffer.from(LOGO, 'utf8'),
      })).rejects.toMatchObject({ status: 400 })

      await expect(attachmentService.createScoped({
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        entityId: 'attachments:library',
        recordId,
        partitionCode: 'privateAttachments',
        fileName: 'hostile.svg',
        declaredMimeType: 'image/svg+xml',
        buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', 'utf8'),
        allowVectorImage: true,
      })).rejects.toMatchObject({ status: 400, body: { code: 'vector_image_unsafe_content' } })

      const created = await attachmentService.createScoped({
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        entityId: 'attachments:library',
        recordId,
        partitionCode: 'privateAttachments',
        fileName: 'brand.svg',
        declaredMimeType: 'image/svg+xml',
        buffer: Buffer.from(LOGO, 'utf8'),
        allowVectorImage: true,
      })
      attachmentId = created.id
      expect(created.mimeType).toBe('image/svg+xml')

      const fileUrl = `${BASE_URL}/api/attachments/file/${encodeURIComponent(attachmentId)}`
      const authorization = { Authorization: `Bearer ${adminToken}` }

      const inline = await request.fetch(fileUrl, { headers: authorization })
      expect(inline.status()).toBe(200)
      expect(inline.headers()['content-type']).toBe('image/svg+xml')
      expect(inline.headers()['content-disposition']).toMatch(/^inline;/)
      expect(inline.headers()['content-security-policy']).toBe(VECTOR_CSP)
      expect(inline.headers()['x-content-type-options']).toBe('nosniff')
      const body = await inline.text()
      expect(body).toMatch(/^<svg[\s>]/)
      expect(body).not.toContain('exported by a vector editor')
      expect(body).toContain('.mark{fill:url(#brand)}')

      for (const encodedPath of [
        `/api/attachments/%66ile/${encodeURIComponent(attachmentId)}`,
        `/api/attachments%2Ffile%2F${encodeURIComponent(attachmentId)}`,
        `/api/%61ttachments/file/${encodeURIComponent(attachmentId)}`,
      ]) {
        const encoded = await request.fetch(`${BASE_URL}${encodedPath}`, { headers: authorization })
        expect(encoded.headers()['content-type'] ?? '').not.toContain('image/svg+xml')
        expect(encoded.headers()['content-disposition'] ?? '').not.toMatch(/^inline;/)
      }

      const forced = await request.fetch(`${fileUrl}?download=1`, { headers: authorization })
      expect(forced.status()).toBe(200)
      expect(forced.headers()['content-type']).toBe('application/octet-stream')
      expect(forced.headers()['content-disposition']).toMatch(/^attachment;/)
      expect(forced.headers()['content-security-policy']).toBe(FILE_PATH_CSP)

      await withClient((client) => client.query(
        "update attachments set storage_metadata = storage_metadata - 'vectorImage' where id = $1",
        [attachmentId],
      ))
      const unrecorded = await request.fetch(fileUrl, { headers: authorization })
      expect(unrecorded.status()).toBe(200)
      expect(unrecorded.headers()['content-type']).toBe('application/octet-stream')
      expect(unrecorded.headers()['content-disposition']).toMatch(/^attachment;/)
      expect(unrecorded.headers()['content-security-policy']).toBe(FILE_PATH_CSP)
      expect(unrecorded.headers()['x-content-type-options']).toBe('nosniff')

      const missing = await request.fetch(`${BASE_URL}/api/attachments/file/00000000-0000-4000-8000-000000000000`, {
        headers: authorization,
      })
      expect(missing.status()).toBe(404)
      expect(missing.headers()['content-security-policy']).toBe(FILE_PATH_CSP)

      const dispatcherNotFound = await request.fetch(`${fileUrl}/unknown-sub-path`, { headers: authorization })
      expect(dispatcherNotFound.status()).toBe(404)
      expect(dispatcherNotFound.headers()['content-security-policy']).toBe(FILE_PATH_CSP)
    } finally {
      await deleteAttachmentIfExists(request, adminToken, attachmentId)
    }
  })
})
