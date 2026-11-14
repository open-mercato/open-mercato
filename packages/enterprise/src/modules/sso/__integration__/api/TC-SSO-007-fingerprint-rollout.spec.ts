import { createHash } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
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
