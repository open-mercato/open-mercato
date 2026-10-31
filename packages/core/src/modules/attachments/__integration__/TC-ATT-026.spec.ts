import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import sharp from 'sharp'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteAttachmentIfExists, uploadAttachmentFixture } from '@open-mercato/core/helpers/integration/attachmentsFixtures'
import { createOrganizationInDb, deleteOrganizationInDb, withClient } from '@open-mercato/core/helpers/integration/dbFixtures'

export const integrationMeta = {
  dependsOnModules: ['attachments', 'catalog'],
}

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'

test.describe('TC-ATT-026: scoped attachment bytes cannot enter shared caches (#7220)', () => {
  for (const isPublic of [true, false]) {
    test(`preserves cache and access policy for ${isPublic ? 'public' : 'private'} partitions`, async ({ request }) => {
      const token = await getAuthToken(request, 'admin')
      const buffer = await sharp({
        create: { width: 2, height: 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
      }).png().toBuffer()
      let attachmentId: string | null = null
      let originalScope: { tenant_id: string; organization_id: string } | null = null
      let otherOrganizationId: string | null = null

      const readBytes = (path: string, authenticated: boolean) => request.get(`${BASE_URL}${path}`, {
        headers: authenticated ? { Authorization: `Bearer ${token}` } : {},
      })

      try {
        const uploaded = await uploadAttachmentFixture(request, token, {
          entityId: isPublic ? 'catalog:catalog_product' : 'attachments:library',
          recordId: `tc-att-026-${randomUUID()}`,
          fileName: 'cache-policy.png',
          mimeType: 'image/png',
          buffer,
        })
        attachmentId = uploaded.id
        originalScope = await withClient(async (client) => {
          const result = await client.query<{ tenant_id: string; organization_id: string }>(
            'select tenant_id, organization_id from attachments where id = $1', [attachmentId],
          )
          return result.rows[0]
        })
        expect(originalScope.tenant_id).toBeTruthy()
        expect(originalScope.organization_id).toBeTruthy()
        const paths = [
          `/api/attachments/file/${attachmentId}`,
          `/api/attachments/image/${attachmentId}?width=1`,
        ]

        for (const path of paths) {
          for (let attempt = 0; attempt < 2; attempt += 1) {
            const response = await readBytes(path, true)
            expect(response.status()).toBe(200)
            expect(response.headers()['cache-control']).toBe('private, max-age=60')
            expect(response.headers()['content-type']).toBe('image/png')
            expect((await response.body()).length).toBeGreaterThan(0)
          }
          expect((await readBytes(path, false)).status()).toBe(401)
        }

        otherOrganizationId = await createOrganizationInDb({ name: `TC-ATT-026 ${randomUUID()}`, tenantId: originalScope.tenant_id })
        await withClient((client) => client.query(
          'update attachments set organization_id = $2 where id = $1', [attachmentId, otherOrganizationId],
        ))
        for (const path of paths) {
          const denied = await readBytes(path, true)
          expect(denied.status()).toBe(404)
          expect(denied.headers()['cache-control'] ?? '').not.toContain('public')
        }

        await withClient((client) => client.query(
          'update attachments set tenant_id = null, organization_id = null where id = $1', [attachmentId],
        ))
        for (const path of paths) {
          const response = await readBytes(path, false)
          expect(response.status()).toBe(isPublic ? 200 : 401)
          if (isPublic) {
            const maxAge = path.includes('/file/') ? 86400 : 3600
            expect(response.headers()['cache-control']).toBe(`public, max-age=${maxAge}`)
            expect((await response.body()).length).toBeGreaterThan(0)
          } else {
            expect(response.headers()['cache-control'] ?? '').not.toContain('public')
          }
        }
      } finally {
        const scopeToRestore = originalScope
        if (attachmentId && scopeToRestore) {
          await withClient((client) => client.query(
            'update attachments set tenant_id = $2, organization_id = $3 where id = $1',
            [attachmentId, scopeToRestore.tenant_id, scopeToRestore.organization_id],
          ))
        }
        await deleteAttachmentIfExists(request, token, attachmentId)
        await deleteOrganizationInDb(otherOrganizationId)
      }
    })
  }
})
