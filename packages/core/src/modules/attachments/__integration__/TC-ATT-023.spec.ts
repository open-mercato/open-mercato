import { expect, test } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { createRoleFixture, deleteRoleIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { ownerPolicyRequest, withAttachmentOwnerFixture } from '@open-mercato/core/helpers/integration/attachmentAccessFixtures'

export const integrationMeta = { dependsOnModules: ['documents'] }

test('TC-ATT-023: removing a share role denies a stale credential without removing view features or the share', async ({ request }) => {
  await withAttachmentOwnerFixture(request, async (fixture) => {
    let shareRole: string | null = null
    try {
      shareRole = await createRoleFixture(request, fixture.admin, { name: `${fixture.prefix}-share-only`, tenantId: getTokenContext(fixture.admin).tenantId })
      const assign = await apiRequest(request, 'PUT', '/api/auth/users', { token: fixture.admin, data: { id: fixture.unshared.id, roles: [fixture.roleId, shareRole] } })
      expect(assign.status()).toBe(200)
      await fixture.share(fixture.hidden, 'viewer', 'role', shareRole)
      await fixture.share(fixture.visible, 'viewer', 'user', fixture.unshared.id)
      const hidden = await fixture.upload(fixture.hidden, 'role-shared'), visible = await fixture.upload(fixture.visible, 'user-shared')
      const credential = await fixture.unshared.refreshToken()
      expect((await ownerPolicyRequest('GET', `/api/attachments/file/${hidden}`, credential)).status).toBe(200)
      const revoke = await apiRequest(request, 'PUT', '/api/auth/users', { token: fixture.admin, data: { id: fixture.unshared.id, roles: [fixture.roleId] } })
      expect(revoke.status()).toBe(200)
      expect((await ownerPolicyRequest('GET', `/api/attachments/file/${hidden}`, credential)).status).toBe(404)
      expect((await ownerPolicyRequest('GET', `/api/attachments/file/${visible}`, credential)).status).toBe(200)
    } finally {
      await deleteRoleIfExists(request, fixture.admin, shareRole)
    }
  })
})
