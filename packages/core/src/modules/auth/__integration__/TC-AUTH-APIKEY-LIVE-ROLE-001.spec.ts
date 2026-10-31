import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createRoleFixture, deleteRoleIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'

export const integrationMeta = { dependsOnModules: ['auth', 'api_keys'] }

for (const isSuperAdmin of [false, true]) {
  test(`a cold API key rejects a deleted role with a live ${isSuperAdmin ? 'super-admin' : 'feature'} ACL`, async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const { tenantId } = getTokenContext(token)
    const stamp = randomUUID()
    let roleId: string | null = null
    const keyIds: string[] = []
    const keyContexts: APIRequestContext[] = []
    try {
      roleId = await createRoleFixture(request, token, { name: `QA key live role ${stamp}`, tenantId })
      const acl = await apiRequest(request, 'PUT', '/api/auth/roles/acl', { token, data: { roleId, isSuperAdmin, features: ['auth.users.list'], organizations: null } })
      expect(acl.status()).toBe(200)
      const keys: Array<{ id: string; secret: string }> = []
      for (const label of ['warm', 'cold']) {
        const created = await apiRequest(request, 'POST', '/api/api_keys/keys', { token, data: { name: `QA ${label} key ${stamp}`, roles: [roleId], organizationId: null } })
        const body = await readJsonSafe<{ id?: string; secret?: string; organizationId?: string | null }>(created)
        if (body?.id) keyIds.push(body.id)
        expect(created.status()).toBe(201)
        expect(body?.organizationId).toBeNull()
        expect(typeof body?.secret).toBe('string')
        keys.push({ id: body!.id!, secret: body!.secret! })
      }
      const warm = await playwrightRequest.newContext({ baseURL: process.env.BASE_URL, extraHTTPHeaders: { 'x-api-key': keys[0].secret } })
      keyContexts.push(warm)
      const before = await warm.post('/api/auth/feature-check', { data: { features: ['auth.users.list'] } })
      expect(before.status()).toBe(200)
      expect(await readJsonSafe(before)).toMatchObject({ ok: true, userId: `api_key:${keys[0].id}`, granted: ['auth.users.list'] })
      expect((await warm.get('/api/auth/users?pageSize=1')).status()).toBe(200)
      await withClient(async (client) => {
        const deleted = await client.query('update roles set deleted_at = now() where id = $1 and tenant_id = $2 and deleted_at is null', [roleId, tenantId])
        expect(deleted.rowCount).toBe(1)
        const remainingAcl = await client.query<{ count: string }>('select count(*) from role_acls where role_id = $1 and tenant_id = $2 and deleted_at is null', [roleId, tenantId])
        expect(Number(remainingAcl.rows[0].count)).toBe(1)
      })
      const cold = await playwrightRequest.newContext({ baseURL: process.env.BASE_URL, extraHTTPHeaders: { 'x-api-key': keys[1].secret } })
      keyContexts.push(cold)
      const after = await cold.post('/api/auth/feature-check', { data: { features: ['auth.users.list'] } })
      expect(after.status()).toBe(200)
      expect(await readJsonSafe(after)).toMatchObject({ ok: false, userId: `api_key:${keys[1].id}`, granted: [] })
      expect((await cold.get('/api/auth/users?pageSize=1')).status()).toBe(403)
    } finally {
      for (const context of keyContexts) await context.dispose()
      for (const keyId of keyIds) expect((await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${encodeURIComponent(keyId)}`, { token })).ok()).toBeTruthy()
      await deleteRoleIfExists(request, token, roleId)
      if (roleId) {
        await withClient(async (client) => {
          const remaining = await client.query<{ count: string }>('select count(*) from roles where id = $1 and tenant_id = $2 and deleted_at is null', [roleId, tenantId])
          expect(Number(remaining.rows[0].count)).toBe(0)
        })
      }
    }
  })
}
