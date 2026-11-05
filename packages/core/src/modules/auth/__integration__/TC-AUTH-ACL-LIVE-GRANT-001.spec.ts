import { expect, test } from '@playwright/test'
import { randomBytes, randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createRoleFixture, createUserFixture, deleteRoleIfExists, deleteUserIfExists, setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'

export const integrationMeta = { dependsOnModules: ['auth', 'api_keys'] }

for (const permitted of [false, true]) {
  test(`role grants use the live ACL when revoked history is ${permitted ? 'stronger' : 'weaker'}`, async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { tenantId, organizationId } = getTokenContext(superadminToken)
    const stamp = randomUUID()
    const password = `Aa1!${randomBytes(20).toString('hex')}`
    const email = `acl-live-${stamp}@example.com`
    const keyName = `QA ACL live grant ${stamp}`
    const roleIds: string[] = []
    let actorUserId: string | null = null
    let keyId: string | null = null
    try {
      const actorRoleId = await createRoleFixture(request, superadminToken, { name: `QA ACL actor ${stamp}`, tenantId })
      roleIds.push(actorRoleId)
      await setRoleAclFeatures(request, superadminToken, { roleId: actorRoleId, features: ['api_keys.create'], organizations: null })
      actorUserId = await createUserFixture(request, superadminToken, { email, password, organizationId, roles: [actorRoleId] })
      const targetRoleId = await createRoleFixture(request, superadminToken, { name: `QA ACL target ${stamp}`, tenantId })
      roleIds.push(targetRoleId)
      await setRoleAclFeatures(request, superadminToken, { roleId: targetRoleId, features: permitted ? ['auth.users.list'] : [], organizations: null })
      await withClient(async (client) => {
        await client.query('begin')
        try {
          const retired = await client.query('update role_acls set deleted_at = now() where role_id = $1 and tenant_id = $2 and deleted_at is null', [targetRoleId, tenantId])
          expect(retired.rowCount).toBe(1)
          await client.query('insert into role_acls (id, role_id, tenant_id, features_json, is_super_admin, organizations_json, created_at, updated_at) values ($1, $2, $3, $4::jsonb, false, null, now(), now())', [randomUUID(), targetRoleId, tenantId, JSON.stringify(permitted ? ['api_keys.create'] : ['auth.users.list'])])
          await client.query('commit')
        } catch (error) {
          await client.query('rollback')
          throw error
        }
      })
      const actorToken = await getAuthToken(request, email, password)
      const response = await apiRequest(request, 'POST', '/api/api_keys/keys', { token: actorToken, data: { name: keyName, roles: [targetRoleId] } })
      const body = await readJsonSafe<{ id?: string; roles?: Array<{ id: string }> }>(response)
      keyId = body?.id ?? null
      expect(response.status()).toBe(permitted ? 201 : 403)
      if (permitted) {
        expect(keyId).toBeTruthy()
        expect(body?.roles?.map((role) => role.id)).toEqual([targetRoleId])
      } else {
        expect(keyId).toBeNull()
        const listed = await apiRequest(request, 'GET', `/api/api_keys/keys?search=${encodeURIComponent(keyName)}`, { token: superadminToken })
        expect(listed.status()).toBe(200)
        const listing = await readJsonSafe<{ items?: Array<{ name: string }> }>(listed)
        expect(listing?.items?.some((key) => key.name === keyName)).toBe(false)
      }
    } finally {
      if (keyId) expect((await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${encodeURIComponent(keyId)}`, { token: superadminToken })).ok()).toBeTruthy()
      await deleteUserIfExists(request, superadminToken, actorUserId)
      for (const roleId of roleIds.reverse()) await deleteRoleIfExists(request, superadminToken, roleId)
      await withClient(async (client) => {
        const remaining = await client.query<{ count: string }>('select count(*) from roles where tenant_id = $1 and id = any($2::uuid[]) and deleted_at is null', [tenantId, roleIds])
        expect(Number(remaining.rows[0].count)).toBe(0)
        if (actorUserId) {
          const users = await client.query<{ count: string }>('select count(*) from users where tenant_id = $1 and id = $2 and deleted_at is null', [tenantId, actorUserId])
          expect(Number(users.rows[0].count)).toBe(0)
        }
      })
    }
  })
}
