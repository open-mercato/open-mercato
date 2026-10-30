import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['auth', 'directory', 'api_keys'] }

test.describe('TC-AUTH-071: session API keys require a live owner in the original scope', () => {
  for (const change of ['deactivated', 'foreign-organization'] as const) {
    test(`rejects cold and prewarmed session keys after the owner becomes ${change}`, async ({ request }) => {
      const adminToken = await getAuthToken(request, 'superadmin')
      const { tenantId } = getTokenScope(adminToken)
      const suffix = randomUUID()
      let organizationId: string | null = null
      let destinationId: string | null = null
      let roleId: string | null = null
      let userId: string | null = null
      const keyIds: string[] = []

      try {
        organizationId = await createOrganizationFixture(request, adminToken, { name: `AUTH 071 ${suffix}` })
        destinationId = await createOrganizationFixture(request, adminToken, { name: `AUTH 071 destination ${suffix}` })
        roleId = await createRoleFixture(request, adminToken, { name: `auth-071-${suffix}` })
        await setRoleAclFeatures(request, adminToken, { roleId, features: ['api_keys.view'], organizations: [organizationId] })
        userId = await createUserFixture(request, adminToken, {
          email: `auth-071-${suffix}@example.test`, password: `Auth-071-${randomUUID()}!`, organizationId, roles: [roleId],
        })

        const secrets: string[] = []
        for (const kind of ['warm-session', 'cold-session', 'regular'] as const) {
          const response = await apiRequest(request, 'POST', '/api/api_keys/keys', {
            token: adminToken,
            data: { name: `AUTH 071 ${kind} ${suffix}`, tenantId, organizationId, roles: [roleId] },
          })
          expect(response.status()).toBe(201)
          const body = await readJsonSafe<{ id?: string; secret?: string }>(response)
          const keyId = expectId(body?.id, 'API key fixture id')
          keyIds.push(keyId)
          secrets.push(expectId(body?.secret, 'API key fixture secret'))
          await withClient(async (client) => {
            await client.query(
              `update api_keys set created_by = $1, session_user_id = $2, session_token = $3,
               expires_at = now() + interval '30 minutes'
               where id = $4 and tenant_id = $5 and organization_id = $6`,
              [userId, kind === 'regular' ? null : userId, kind === 'regular' ? null : `sess_${randomUUID().replace(/-/g, '')}`, keyId, tenantId, organizationId],
            )
          })
        }

        await withCredentialIsolatedRequest(async (isolated) => {
          const authenticate = (secret: string) => isolated.post('/api/auth/feature-check', {
            headers: { 'x-api-key': secret }, data: { features: [] },
          })
          expect((await authenticate(secrets[0])).status(), 'active session owner must authenticate').toBe(200)
          expect((await authenticate(secrets[0])).status(), 'session key cache must be warm').toBe(200)
          expect((await authenticate(secrets[2])).status(), 'regular key control must authenticate').toBe(200)

          if (change === 'deactivated') {
            const response = await apiRequest(request, 'PUT', '/api/auth/users', {
              token: adminToken, data: { id: userId, isConfirmed: false },
            })
            expect(response.status()).toBe(200)
          } else {
            await withClient(async (client) => {
              await client.query('update users set organization_id = $1 where id = $2 and tenant_id = $3', [destinationId, userId, tenantId])
            })
          }

          expect((await authenticate(secrets[0])).status(), 'prewarmed session key must fail immediately').toBe(401)
          expect((await authenticate(secrets[1])).status(), 'cold session key must fail too').toBe(401)
          if (change === 'deactivated') {
            expect((await authenticate(secrets[2])).status(), 'regular key policy must remain unchanged').toBe(200)
          }
        })
      } finally {
        for (const keyId of keyIds) {
          const response = await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${keyId}`, { token: adminToken }).catch(() => null)
          expect.soft(response?.status(), 'fixture key cleanup must succeed').toBe(200)
        }
        await deleteUserIfExists(request, adminToken, userId)
        await deleteRoleIfExists(request, adminToken, roleId)
        await deleteOrganizationIfExists(request, adminToken, destinationId)
        await deleteOrganizationIfExists(request, adminToken, organizationId)
      }
    })
  }
})
