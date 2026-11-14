import { expect, test } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { OWNER_ACCESS_FEATURES, ownerPolicyRequest, withAttachmentOwnerFixture } from '@open-mercato/core/helpers/integration/attachmentAccessFixtures'

export const integrationMeta = { dependsOnModules: ['documents', 'api_keys'] }

test('TC-ATT-020: host reads use current user features and current API-key role shares', async ({ request }) => {
  await withAttachmentOwnerFixture(request, async (fixture) => {
    const file = await fixture.upload(fixture.visible, 'user-features')
    const path = `/api/attachments/file/${file}`
    expect((await ownerPolicyRequest('GET', path, fixture.recipient.token)).status).toBe(200)
    await setRoleAclFeatures(request, fixture.admin, { roleId: fixture.roleId, features: OWNER_ACCESS_FEATURES.filter(feature => feature !== 'documents.view') })
    expect((await ownerPolicyRequest('GET', path, fixture.recipient.token)).status).toBe(404)
    await setRoleAclFeatures(request, fixture.admin, { roleId: fixture.roleId, features: OWNER_ACCESS_FEATURES })
    const document = await fixture.document('key-owned-by-other-user', fixture.recipient.token)
    const keyFile = await fixture.upload(document, 'key-shared')
    const key = await fixture.key()
    const keyPath = `/api/attachments/file/${keyFile}`
    expect((await ownerPolicyRequest('GET', keyPath, key.secret, undefined, 'ApiKey')).status).toBe(404)
    const share = await fixture.share(document, 'viewer', 'role', fixture.roleId, fixture.recipient.token)
    expect((await ownerPolicyRequest('GET', keyPath, key.secret, undefined, 'ApiKey')).status).toBe(200)
    const revoked = await apiRequest(request, 'DELETE', `/api/documents/${document}/shares`, { token: fixture.recipient.token, data: { id: share.id }, headers: { 'x-om-ext-optimistic-lock-expected-updated-at': share.updatedAt } })
    expect(revoked.status()).toBe(200)
    expect((await ownerPolicyRequest('GET', keyPath, key.secret, undefined, 'ApiKey')).status).toBe(404)
  })
})
