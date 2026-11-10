import { randomUUID } from 'node:crypto'
import { getRounds } from 'bcryptjs'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { createRoleFixture, deleteRoleIfExists, setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'

test('TC-APIKEY-3811: cost-12 keys throttle varied guesses, recover, and remain revocable', async ({ request }) => {
  const token = await getAuthToken(request, 'superadmin')
  const { tenantId } = getTokenContext(token)
  const stamp = randomUUID()
  let roleId: string | null = null
  let keyId: string | null = null
  try {
    roleId = await createRoleFixture(request, token, { name: `qa-work-limit-${stamp}`, tenantId })
    await setRoleAclFeatures(request, token, { roleId, features: ['api_keys.view'], organizations: null })
    const created = await apiRequest(request, 'POST', '/api/api_keys/keys', {
      token, data: { name: `qa-work-limit-${stamp}`, roles: [roleId], organizationId: null },
    })
    expect(created.status()).toBe(201)
    const key = await readJsonSafe<{ id?: string; secret?: string; keyPrefix?: string }>(created)
    keyId = expectId(key?.id, 'API-key fixture')
    const secret = expectId(key?.secret, 'one-time API-key secret')
    const prefix = expectId(key?.keyPrefix, 'public API-key prefix')
    await withClient(async (client) => {
      const { rows } = await client.query<{ key_hash: string }>(
        'select key_hash from api_keys where id = $1 and tenant_id = $2', [keyId, tenantId],
      )
      expect(rows).toHaveLength(1)
      expect(getRounds(rows[0].key_hash)).toBe(12)
    })
    await withCredentialIsolatedRequest(async (keyRequest) => {
      const guesses = await Promise.all(Array.from({ length: 20 }, (_, attempt) => (
        keyRequest.get('/api/api_keys/keys', { headers: { 'x-api-key': `${prefix}.wrong-${attempt}` } })
      )))
      expect(guesses.some((response) => response.status() === 429)).toBe(true)
      for (const response of guesses) {
        expect([401, 429]).toContain(response.status())
        if (response.status() === 429) expect(Number(response.headers()['retry-after'])).toBeGreaterThan(0)
      }
      let authenticated = await keyRequest.get('/api/api_keys/keys', { headers: { 'x-api-key': secret } })
      for (let attempt = 0; authenticated.status() === 429 && attempt < 4; attempt++) {
        const retryAfter = Number(authenticated.headers()['retry-after'])
        expect(retryAfter).toBeGreaterThan(0)
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000))
        authenticated = await keyRequest.get('/api/api_keys/keys', { headers: { 'x-api-key': secret } })
      }
      expect(authenticated.status(), 'Capacity recovery must not become a cached bad credential').toBe(200)
      const deleted = await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${keyId}`, { token })
      expect(deleted.status()).toBe(200)
      keyId = null
      expect((await keyRequest.get('/api/api_keys/keys', { headers: { 'x-api-key': secret } })).status()).toBe(401)
    })
  } finally {
    if (keyId) await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${keyId}`, { token })
    await deleteRoleIfExists(request, token, roleId)
  }
})
