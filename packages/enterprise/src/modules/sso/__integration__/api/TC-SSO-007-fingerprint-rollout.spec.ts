import { createHash, randomUUID } from 'node:crypto'
import { expect, request as playwrightRequest, test } from '@playwright/test'
import { createRoleFixture, createUserFixture, deleteRoleIfExists, deleteUserIfExists, setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { createOrganizationInDb, deleteOrganizationInDb, withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  apiRequest,
  createSsoConfigFixture,
  createScimTokenFixture,
  addDomainFixture,
  activateConfigFixture,
  getAuthToken,
  scimRequest,
} from '../helpers/ssoFixtures'

test('TC-SSO-007: fingerprints persist, legacy credentials enroll, and revoked credentials stay rejected', async ({ request }) => {
  const adminToken = await getAuthToken(request, 'admin')
  const { configId, cleanup: cleanupConfig } = await createSsoConfigFixture(request, adminToken, {
    jitEnabled: false,
    issuer: 'https://accounts.google.com',
  })
  let cleanupToken: (() => Promise<void>) | undefined
  try {
    const issued = await createScimTokenFixture(request, adminToken, configId)
    cleanupToken = issued.cleanup
    const fingerprint = createHash('sha256').update(issued.rawToken).digest('hex')
    const scope = await withClient(async (client) => {
      const result = await client.query<{ tenant_id: string | null; organization_id: string; matches: boolean }>(
        'select tenant_id, organization_id, token_lookup_hash = $2 as matches from scim_tokens where id = $1',
        [issued.tokenId, fingerprint],
      )
      expect(result.rows[0]?.matches).toBe(true)
      return result.rows[0]
    })
    const listedResponse = await apiRequest(request, 'GET', `/api/sso/scim/tokens?ssoConfigId=${configId}`, { token: adminToken })
    expect(listedResponse.ok()).toBe(true)
    const listed = await listedResponse.json() as { items: Array<Record<string, unknown>> }
    const publicToken = listed.items.find((item) => item.id === issued.tokenId)
    expect(publicToken).toBeDefined()
    for (const privateField of ['tokenLookupHash', 'token_lookup_hash', 'tokenHash', 'token_hash', 'token']) {
      expect(publicToken).not.toHaveProperty(privateField)
    }
    expect(scope.tenant_id).not.toBeNull()
    const superadminToken = await getAuthToken(request, 'superadmin')
    let restrictedRoleId: string | null = null
    let restrictedUserId: string | null = null
    const restrictedRequest = await playwrightRequest.newContext()
    try {
      restrictedRoleId = await createRoleFixture(request, superadminToken, { name: `scim-restricted-${issued.tokenId}`, tenantId: scope.tenant_id! })
      await setRoleAclFeatures(request, superadminToken, { roleId: restrictedRoleId, features: [], organizations: [scope.organization_id] })
      const email = `scim-restricted-${issued.tokenId}@example.com`
      const password = `QA-${randomUUID()}!aA1`
      restrictedUserId = await createUserFixture(request, superadminToken, { email, password, organizationId: scope.organization_id, roles: [restrictedRoleId] })
      const restrictedToken = await getAuthToken(restrictedRequest, email, password)
      expect((await apiRequest(restrictedRequest, 'GET', `/api/sso/scim/tokens?ssoConfigId=${configId}`, { token: restrictedToken })).status()).toBe(403)
    } finally {
      await restrictedRequest.dispose()
      await deleteUserIfExists(request, superadminToken, restrictedUserId)
      await deleteRoleIfExists(request, superadminToken, restrictedRoleId)
    }
    const foreignOrganizationId = await createOrganizationInDb({ name: `SCIM fingerprint scope ${issued.tokenId}`, tenantId: scope.tenant_id! })
    try {
      await withClient(async (client) => {
        await client.query('update scim_tokens set organization_id = $2 where id = $1', [issued.tokenId, foreignOrganizationId])
      })
      const foreignList = await apiRequest(request, 'GET', `/api/sso/scim/tokens?ssoConfigId=${configId}`, { token: adminToken })
      expect(foreignList.status()).toBe(200)
      expect(await foreignList.json()).toEqual({ items: [] })
      expect((await apiRequest(request, 'DELETE', `/api/sso/scim/tokens/${issued.tokenId}`, { token: adminToken })).status()).toBe(404)
    } finally {
      await withClient(async (client) => {
        await client.query('update scim_tokens set organization_id = $2 where id = $1', [issued.tokenId, scope.organization_id])
      })
      await deleteOrganizationInDb(foreignOrganizationId)
    }
    await addDomainFixture(request, adminToken, configId, `fingerprint-${issued.tokenId}.example.com`)
    await activateConfigFixture(request, adminToken, configId)
    expect((await scimRequest(request, 'GET', '/api/sso/scim/v2/Users?count=1', issued.rawToken)).status()).toBe(200)
    await withClient(async (client) => {
      await client.query(
        'update scim_tokens set token_lookup_hash = null where id = $1 and organization_id = $2 and tenant_id is not distinct from $3',
        [issued.tokenId, scope.organization_id, scope.tenant_id],
      )
    })
    expect((await scimRequest(request, 'GET', '/api/sso/scim/v2/Users?count=1', issued.rawToken)).status()).toBe(200)
    await withClient(async (client) => {
      const result = await client.query<{ matches: boolean }>(
        'select token_lookup_hash = $2 as matches from scim_tokens where id = $1 and organization_id = $3 and tenant_id is not distinct from $4',
        [issued.tokenId, fingerprint, scope.organization_id, scope.tenant_id],
      )
      expect(result.rows[0]?.matches).toBe(true)
    })
    expect((await apiRequest(request, 'DELETE', `/api/sso/scim/tokens/${issued.tokenId}`, { token: adminToken })).status()).toBe(200)
    expect((await scimRequest(request, 'GET', '/api/sso/scim/v2/Users?count=1', issued.rawToken)).status()).toBe(401)
  } finally {
    await cleanupToken?.()
    await apiRequest(request, 'POST', `/api/sso/config/${configId}/activate`, { token: adminToken, data: { active: false } })
    await cleanupConfig()
  }
})
