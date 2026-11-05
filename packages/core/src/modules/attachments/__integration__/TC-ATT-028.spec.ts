import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import sharp from 'sharp'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createRoleFixture, createUserFixture, deleteRoleIfExists, deleteUserIfExists, setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { deleteAttachmentIfExists, uploadAttachmentFixture } from '@open-mercato/core/helpers/integration/attachmentsFixtures'

export const integrationMeta = { dependsOnModules: ['auth', 'attachments'] }

const cases = [
  { name: 'no read feature', features: [], status: 403 },
  { name: 'manage without read', features: ['attachments.manage'], status: 403 },
  { name: 'exact read', features: ['attachments.view'], status: 200 },
  { name: 'module wildcard', features: ['attachments.*'], status: 200 },
  { name: 'global wildcard', features: ['*'], status: 200 },
]

test.describe('TC-ATT-028: private byte routes enforce current read capability (#8760)', () => {
  for (const scenario of cases) {
    test(scenario.name, async ({ request }) => {
      const adminToken = await getAuthToken(request, 'superadmin')
      const { organizationId } = getTokenContext(adminToken)
      const stamp = randomUUID()
      const email = `tc-att-028-${stamp}@example.com`
      const password = `Fixture-${randomUUID()}-1!`
      let roleId: string | null = null
      let userId: string | null = null
      let attachmentId: string | null = null
      try {
        roleId = await createRoleFixture(request, adminToken, { name: `tc-att-028-${stamp}` })
        await setRoleAclFeatures(request, adminToken, { roleId, features: scenario.features, organizations: [organizationId] })
        userId = await createUserFixture(request, adminToken, { email, password, organizationId, roles: [roleId] })
        const token = await getAuthToken(request, email, password)
        const buffer = await sharp({
          create: { width: 2, height: 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
        }).png().toBuffer()
        const uploaded = await uploadAttachmentFixture(request, adminToken, {
          entityId: 'attachments:library', recordId: stamp, partitionCode: 'privateAttachments',
          fileName: `tc-att-028-${stamp}.png`, mimeType: 'image/png', buffer,
        })
        attachmentId = uploaded.id
        const paths = [
          `/api/attachments/file/${attachmentId}`,
          `/api/attachments/file/${attachmentId}?download=1`,
          `/api/attachments/image/${attachmentId}?width=1`,
        ]
        const warm = await apiRequest(request, 'GET', paths[2], { token: adminToken })
        expect(warm.status()).toBe(200)
        for (const path of paths) {
          const response = await apiRequest(request, 'GET', path, { token })
          expect(response.status(), path).toBe(scenario.status)
          if (scenario.status === 200) {
            const body = await response.body()
            expect(body.length).toBeGreaterThan(0)
            if (!path.includes('/image/')) expect(body).toEqual(buffer)
          } else {
            expect(response.headers()['content-type']).toContain('application/json')
            expect(response.headers()['cache-control'] ?? '').not.toContain('public')
          }
          const anonymous = await apiRequest(request, 'GET', path, { token: '', headers: { Authorization: '' } })
          expect(anonymous.status()).toBe(401)
        }
      } finally {
        await deleteAttachmentIfExists(request, adminToken, attachmentId)
        await deleteUserIfExists(request, adminToken, userId)
        await deleteRoleIfExists(request, adminToken, roleId)
      }
    })
  }
})
