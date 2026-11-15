import { randomUUID } from 'node:crypto'
import { emailHashLookupValues } from '@open-mercato/core/modules/auth/lib/emailHash'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createRoleFixture, deleteRoleIfExists, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { deleteGeneralEntityIfExists, expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

test('TC-AUTH-8850: rejected creation leaves no user or memberships after a role tenant move', async ({ request }) => {
  test.setTimeout(90_000)
  const token = await getAuthToken(request, 'superadmin')
  const adminToken = await getAuthToken(request, 'admin')
  const scope = getTokenScope(adminToken)
  const tenantId = expectId(scope.tenantId, 'Admin tenant')
  const organizationId = expectId(scope.organizationId, 'Admin organization')
  const stamp = randomUUID()
  const email = `auth-8850-${stamp}@example.com`
  let roleId: string | null = null
  let foreignTenantId: string | null = null
  let leftoverUserId: string | null = null
  try {
    roleId = await createRoleFixture(request, token, { name: `auth-8850-${stamp}`, tenantId })
    const tenantResponse = await apiRequest(request, 'POST', '/api/directory/tenants', { token, data: { name: `auth-8850-${stamp}` } })
    expect(tenantResponse.status()).toBe(201)
    foreignTenantId = expectId((await readJsonSafe<{ id?: string }>(tenantResponse))?.id, 'Foreign tenant')
    const response = await withClient(async (blocker) => {
      await blocker.query('begin')
      let pending: ReturnType<typeof apiRequest> | undefined
      try {
        await blocker.query("set local statement_timeout = '20s'")
        await blocker.query('update roles set tenant_id = $1 where id = $2', [foreignTenantId, roleId])
        await blocker.query('lock table users in share mode')
        const pid = (await blocker.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid
        pending = apiRequest(request, 'POST', '/api/auth/users', {
          token,
          data: { email, password: 'StrongSecret123!', organizationId, roles: [`auth-8850-${stamp}`], sendInviteEmail: true },
          timeout: 30_000,
          retryTransport: false,
        })
        await withClient(async (observer) => {
          await expect.poll(async () => {
            const result = await observer.query<{ count: string }>('select count(*)::text as count from pg_stat_activity where $1 = any(pg_blocking_pids(pid))', [pid])
            return Number(result.rows[0].count)
          }, { timeout: 20_000 }).toBeGreaterThan(0)
        })
        await blocker.query('commit')
        return await pending
      } finally {
        await blocker.query('rollback')
        if (pending) await pending.catch(() => undefined)
      }
    })
    expect(response.status(), await response.text()).toBe(400)
    expect(await response.text()).toContain('Role(s) not found')
    const state = await withClient(async (client) => {
      const users = await client.query<{ id: string }>('select id from users where email_hash = any($1::text[])', [emailHashLookupValues(email)])
      leftoverUserId = users.rows[0]?.id ?? null
      const memberships = await client.query<{ count: string }>('select count(*)::text as count from user_roles where role_id = $1', [roleId])
      return { users: users.rows.length, memberships: Number(memberships.rows[0].count) }
    })
    console.log('AUTH-8850 rejected creation database state:', state)
    expect(state).toEqual({ users: 0, memberships: 0 })
  } finally {
    if (!leftoverUserId) leftoverUserId = await withClient(async (client) => (await client.query<{ id: string }>('select id from users where email_hash = any($1::text[])', [emailHashLookupValues(email)])).rows[0]?.id ?? null)
    await deleteUserIfExists(request, token, leftoverUserId)
    await deleteRoleIfExists(request, token, roleId)
    await deleteGeneralEntityIfExists(request, token, '/api/directory/tenants', foreignTenantId)
  }
})

for (const assignRole of [false, true]) {
  test(`TC-AUTH-8850: successful creation ${assignRole ? 'with' : 'without'} roles preserves scope and duplicate checks`, async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(await getAuthToken(request, 'admin'))
    const tenantId = expectId(scope.tenantId, 'Admin tenant')
    const organizationId = expectId(scope.organizationId, 'Admin organization')
    const stamp = randomUUID()
    const email = `auth-8850-success-${stamp}@example.com`
    let roleId: string | null = null
    let userId: string | null = null
    try {
      if (assignRole) roleId = await createRoleFixture(request, token, { name: `auth-8850-success-${stamp}`, tenantId })
      const data = { email, password: 'StrongSecret123!', organizationId, roles: roleId ? [roleId] : [] }
      const response = await apiRequest(request, 'POST', '/api/auth/users', { token, data })
      expect(response.status(), await response.text()).toBe(201)
      userId = expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'Created user')
      await withClient(async (client) => {
        const user = (await client.query<{ tenant_id: string; organization_id: string; is_confirmed: boolean }>('select tenant_id, organization_id, is_confirmed from users where id = $1', [userId])).rows[0]
        expect(user).toEqual({ tenant_id: tenantId, organization_id: organizationId, is_confirmed: true })
        const links = await client.query<{ role_id: string }>('select role_id from user_roles where user_id = $1 and deleted_at is null', [userId])
        expect(links.rows.map((link) => link.role_id)).toEqual(roleId ? [roleId] : [])
        if (roleId) {
          const notifications = await client.query<{ count: string }>("select count(*)::text as count from notifications where source_entity_id = $1 and type = 'auth.role.assigned'", [userId])
          expect(Number(notifications.rows[0].count)).toBe(1)
        }
      })
      const duplicate = await apiRequest(request, 'POST', '/api/auth/users', { token, data })
      expect(duplicate.status(), await duplicate.text()).toBe(400)
      await withClient(async (client) => {
        const users = await client.query<{ count: string }>('select count(*)::text as count from users where email_hash = any($1::text[]) and tenant_id = $2', [emailHashLookupValues(email), tenantId])
        expect(Number(users.rows[0].count)).toBe(1)
      })
    } finally {
      await deleteUserIfExists(request, token, userId)
      await deleteRoleIfExists(request, token, roleId)
    }
  })
}
