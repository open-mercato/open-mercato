import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import sharp from 'sharp'
import { OWNER_ACCESS_PNG, ownerPolicyRequest, withAttachmentOwnerFixture } from '@open-mercato/core/helpers/integration/attachmentAccessFixtures'

export const integrationMeta = { dependsOnModules: ['documents', 'catalog'] }

test('TC-ATT-017: host bytes use the real document share policy and retain unrelated owners', async ({ request }) => {
  await withAttachmentOwnerFixture(request, async (fixture) => {
    const file = await fixture.uploadProxy(fixture.visible)
    for (const path of [file.url, `/api/attachments/file/${file.attachmentId}`, `/api/attachments/image/${file.attachmentId}?width=16`]) {
      const allowed = await ownerPolicyRequest('GET', path, fixture.recipient.token)
      expect(allowed.status, path).toBe(200)
      expect(allowed.headers['cache-control']).toContain('private, no-store')
      expect(allowed.headers['content-type']).toContain('image/png')
      if (!path.includes('/image/')) expect(allowed.bytes).toEqual(OWNER_ACCESS_PNG)
      else expect((await sharp(allowed.bytes).raw().toBuffer({ resolveWithObject: true })).info).toMatchObject({ width: 16, height: 16 })
      const denied = await ownerPolicyRequest('GET', path, fixture.unshared.token)
      expect(denied.status, path).toBe(path.startsWith('/api/documents/') ? 403 : 404)
      expect(denied.bytes.equals(OWNER_ACCESS_PNG)).toBe(false)
    }
    const publicImage = await fixture.uploadPublicImage(fixture.visible)
    for (const kind of ['file', 'image']) {
      const path = `/api/attachments/${kind}/${publicImage}${kind === 'image' ? '?width=16' : ''}`
      const allowed = await ownerPolicyRequest('GET', path, fixture.recipient.token)
      expect(allowed.status).toBe(200)
      expect(allowed.headers['cache-control']).toBe('private, no-store')
      expect((await sharp(allowed.bytes).raw().toBuffer({ resolveWithObject: true })).info.width).toBe(kind === 'image' ? 16 : 2)
      const denied = await ownerPolicyRequest('GET', path, fixture.unshared.token)
      expect(denied.status).toBe(404)
      expect(denied.headers['cache-control']).toBe('private, no-store')
    }
    const unrelated = await fixture.upload(randomUUID(), 'unrelated', { entityId: 'sync_excel:import' })
    const read = await ownerPolicyRequest('GET', `/api/attachments/file/${unrelated}`, fixture.unshared.token)
    expect(read.status).toBe(200)
    expect(read.headers['cache-control']).toBe('private, max-age=60')
  })
})
