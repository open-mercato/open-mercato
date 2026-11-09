import { randomInt } from 'node:crypto'
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import {
  apiRequest,
  getAuthToken,
  withCredentialIsolatedRequest,
} from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient, type IntegrationDbClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { deleteGeneralEntityIfExists, expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectOperation, skipIfUndoTestsDisabled, undoByToken } from '@open-mercato/core/helpers/integration/undoHarness'

const RACE_TIMEOUT_MS = 10_000

type RoleRow = { name: string; tenant_id: string | null }

async function createTenant(request: APIRequestContext, token: string, name: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', {
    token,
    data: { name },
  })
  expect(response.status()).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, 'Tenant create response should include id')
}

async function readRole(roleId: string): Promise<RoleRow> {
  return withClient(async (client) => {
    const result = await client.query<RoleRow>('select name, tenant_id from roles where id = $1', [roleId])
    const row = result.rows[0]
    if (!row) throw new Error('[internal] Role fixture row is missing')
    return row
  })
}

async function countActiveAssignments(roleId: string): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ count: string }>(
      'select count(*)::text as count from user_roles where role_id = $1 and deleted_at is null',
      [roleId],
    )
    return Number(result.rows[0]?.count ?? 0)
  })
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  return withClient(async (client) => {
    const result = await client.query<{ id: string }>(
      'select id from users where email = $1 and deleted_at is null',
      [email],
    )
    return result.rows[0]?.id ?? null
  })
}

async function assignRole(request: APIRequestContext, token: string, userId: string, roleId: string): Promise<void> {
  const response = await apiRequest(request, 'PUT', '/api/auth/users', {
    token,
    data: { id: userId, roles: [roleId] },
  })
  expect(response.status(), await response.text()).toBe(200)
}

async function waitUntilBlockedCount(
  client: IntegrationDbClient,
  blockerPid: number,
  expectedCount: number,
): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const result = await client.query<{ blocked_count: string }>(
      `with recursive blocked(pid) as (
         select activity.pid
           from pg_stat_activity activity
          where $1 = any(pg_blocking_pids(activity.pid))
         union
         select activity.pid
           from pg_stat_activity activity
           join blocked blocker
             on blocker.pid = any(pg_blocking_pids(activity.pid))
       )
       select count(*)::text as blocked_count from blocked`,
      [blockerPid],
    )
    if (Number(result.rows[0]?.blocked_count ?? '0') >= expectedCount) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('[internal] Race contenders did not reach the role row lock')
}

type AssignmentRequest = { method: 'POST' | 'PUT'; data: Record<string, unknown> }

async function raceRoleUpdateBehindAssignment(
  token: string,
  roleId: string,
  assignment: AssignmentRequest,
  roleUpdate: Record<string, unknown>,
  firstInQueue: 'assignment' | 'update' = 'assignment',
): Promise<{
  assignment: { status: number; body: string }
  update: { status: number; body: string }
}> {
  return withCredentialIsolatedRequest(async (assignmentRequest) => (
    withCredentialIsolatedRequest(async (updateRequest) => (
      withClient(async (blocker) => {
        const pending: Promise<APIResponse>[] = []
        await blocker.query('begin')
        try {
          const blockerPid = Number((await blocker.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid)
          await blocker.query('select id from roles where id = $1 for update', [roleId])
          const startAssignment = (): Promise<APIResponse> => apiRequest(assignmentRequest, assignment.method, '/api/auth/users', {
            token,
            data: assignment.data,
            timeout: RACE_TIMEOUT_MS,
            retryTransport: false,
          })
          const startUpdate = (): Promise<APIResponse> => apiRequest(updateRequest, 'PUT', '/api/auth/roles', {
            token,
            data: { id: roleId, ...roleUpdate },
            timeout: RACE_TIMEOUT_MS,
            retryTransport: false,
          })
          const [startFirst, startSecond] = firstInQueue === 'assignment'
            ? [startAssignment, startUpdate]
            : [startUpdate, startAssignment]
          const pendingFirst = startFirst()
          pending.push(pendingFirst)
          await withClient((observer) => waitUntilBlockedCount(observer, blockerPid, 1))
          const pendingSecond = startSecond()
          pending.push(pendingSecond)
          await withClient((observer) => waitUntilBlockedCount(observer, blockerPid, 2))
          const [pendingAssignment, pendingUpdate] = firstInQueue === 'assignment'
            ? [pendingFirst, pendingSecond]
            : [pendingSecond, pendingFirst]
          await blocker.query('commit')
          const [assignmentResponse, updateResponse] = await Promise.all([pendingAssignment, pendingUpdate])
          return {
            assignment: { status: assignmentResponse.status(), body: await assignmentResponse.text() },
            update: { status: updateResponse.status(), body: await updateResponse.text() },
          }
        } catch (error) {
          await blocker.query('rollback').catch(() => undefined)
          await Promise.allSettled(pending)
          throw error
        }
      })
    ))
  ))
}

test.describe('TC-AUTH-073: role rename, tenant move and their undo recheck assignments under the role lock', () => {
  test('rejects a rename when a user assignment commits while the rename waits for the role lock', async ({ request }) => {
    test.setTimeout(RACE_TIMEOUT_MS * 4)
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const adminScope = getTokenScope(adminToken)
    const tenantId = expectId(adminScope.tenantId, 'Admin token should include tenant id')
    const organizationId = expectId(adminScope.organizationId, 'Admin token should include organization id')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const roleName = `qa-auth-073-rename-${stamp}`
    let roleId: string | null = null
    let userId: string | null = null

    try {
      roleId = await createRoleFixture(request, superadminToken, { name: roleName, tenantId })
      userId = await createUserFixture(request, superadminToken, {
        email: `qa-auth-073-rename-${stamp}@example.com`,
        password: 'StrongSecret123!',
        organizationId,
        roles: [],
      })

      const result = await raceRoleUpdateBehindAssignment(superadminToken, roleId, { method: 'PUT', data: { id: userId, roles: [roleId] } }, {
        name: `${roleName}-renamed`,
      })

      expect(result.assignment.status, result.assignment.body).toBe(200)
      expect(result.update.status, result.update.body).toBe(400)
      expect(result.update.body).toContain('Role name cannot be changed while users are assigned')
      expect(await countActiveAssignments(roleId)).toBe(1)
      expect((await readRole(roleId)).name).toBe(roleName)
    } finally {
      await deleteUserIfExists(request, superadminToken, userId)
      await deleteRoleIfExists(request, superadminToken, roleId)
    }
  })

  test('rejects a tenant move when a user assignment commits while the move waits for the role lock', async ({ request }) => {
    test.setTimeout(RACE_TIMEOUT_MS * 4)
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const adminScope = getTokenScope(adminToken)
    const tenantId = expectId(adminScope.tenantId, 'Admin token should include tenant id')
    const organizationId = expectId(adminScope.organizationId, 'Admin token should include organization id')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    let roleId: string | null = null
    let userId: string | null = null
    let foreignTenantId: string | null = null

    try {
      roleId = await createRoleFixture(request, superadminToken, { name: `qa-auth-073-move-${stamp}`, tenantId })
      userId = await createUserFixture(request, superadminToken, {
        email: `qa-auth-073-move-${stamp}@example.com`,
        password: 'StrongSecret123!',
        organizationId,
        roles: [],
      })
      foreignTenantId = await createTenant(request, superadminToken, `QA AUTH-073 tenant ${stamp}`)

      const result = await raceRoleUpdateBehindAssignment(superadminToken, roleId, { method: 'PUT', data: { id: userId, roles: [roleId] } }, {
        tenantId: foreignTenantId,
      })

      expect(result.assignment.status, result.assignment.body).toBe(200)
      expect(result.update.status, result.update.body).toBe(400)
      expect(result.update.body).toContain('Role cannot be moved to another tenant while users are assigned')
      expect(await countActiveAssignments(roleId)).toBe(1)
      expect((await readRole(roleId)).tenant_id).toBe(tenantId)
    } finally {
      await deleteUserIfExists(request, superadminToken, userId)
      await deleteRoleIfExists(request, superadminToken, roleId)
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', foreignTenantId)
    }
  })

  test('rejects a role assignment that resumes after a tenant move committed under the role lock', async ({ request }) => {
    test.setTimeout(RACE_TIMEOUT_MS * 4)
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const adminScope = getTokenScope(adminToken)
    const tenantId = expectId(adminScope.tenantId, 'Admin token should include tenant id')
    const organizationId = expectId(adminScope.organizationId, 'Admin token should include organization id')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const email = `qa-auth-073-move-first-${stamp}@example.com`
    let roleId: string | null = null
    let userId: string | null = null
    let foreignTenantId: string | null = null

    try {
      roleId = await createRoleFixture(request, superadminToken, { name: `qa-auth-073-move-first-${stamp}`, tenantId })
      foreignTenantId = await createTenant(request, superadminToken, `QA AUTH-073 move-first tenant ${stamp}`)

      const result = await raceRoleUpdateBehindAssignment(superadminToken, roleId, {
        method: 'POST',
        data: { email, password: 'StrongSecret123!', organizationId, roles: [roleId] },
      }, { tenantId: foreignTenantId }, 'update')
      userId = await findUserIdByEmail(email)

      expect(result.update.status, result.update.body).toBe(200)
      expect(result.assignment.status, result.assignment.body).toBe(400)
      expect(result.assignment.body).toContain('Role(s) not found')
      expect(await countActiveAssignments(roleId)).toBe(0)
      expect((await readRole(roleId)).tenant_id).toBe(foreignTenantId)
    } finally {
      userId = userId ?? await findUserIdByEmail(email)
      await deleteUserIfExists(request, superadminToken, userId)
      await deleteRoleIfExists(request, superadminToken, roleId)
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', foreignTenantId)
    }
  })

  test('rejects undoing a rename after a user was assigned to the renamed role', async ({ request }) => {
    skipIfUndoTestsDisabled()
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const adminScope = getTokenScope(adminToken)
    const tenantId = expectId(adminScope.tenantId, 'Admin token should include tenant id')
    const organizationId = expectId(adminScope.organizationId, 'Admin token should include organization id')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const roleName = `qa-auth-073-undo-rename-${stamp}`
    const renamed = `${roleName}-renamed`
    let roleId: string | null = null
    let userId: string | null = null

    try {
      roleId = await createRoleFixture(request, superadminToken, { name: roleName, tenantId })
      userId = await createUserFixture(request, superadminToken, {
        email: `qa-auth-073-undo-rename-${stamp}@example.com`,
        password: 'StrongSecret123!',
        organizationId,
        roles: [],
      })
      const renameResponse = await apiRequest(request, 'PUT', '/api/auth/roles', {
        token: superadminToken,
        data: { id: roleId, name: renamed },
      })
      expect(renameResponse.status(), await renameResponse.text()).toBe(200)
      const operation = expectOperation(renameResponse, 'role rename')
      await assignRole(request, superadminToken, userId, roleId)

      const undoResponse = await undoByToken(request, superadminToken, operation.undoToken)

      expect(undoResponse.status(), await undoResponse.text()).toBe(409)
      expect(await undoResponse.text()).toContain('Role name cannot be changed while users are assigned')
      expect((await readRole(roleId)).name).toBe(renamed)
      expect(await countActiveAssignments(roleId)).toBe(1)
    } finally {
      await deleteUserIfExists(request, superadminToken, userId)
      await deleteRoleIfExists(request, superadminToken, roleId)
    }
  })

  test('rejects undoing a tenant move after a user was assigned in the destination tenant', async ({ request }) => {
    skipIfUndoTestsDisabled()
    const superadminToken = await getAuthToken(request, 'superadmin')
    const superadminTenantId = expectId(getTokenScope(superadminToken).tenantId, 'Superadmin token should include tenant id')
    const adminToken = await getAuthToken(request, 'admin')
    const adminScope = getTokenScope(adminToken)
    const organizationId = expectId(adminScope.organizationId, 'Admin token should include organization id')
    expect(adminScope.tenantId).toBe(superadminTenantId)
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    let roleId: string | null = null
    let userId: string | null = null
    let foreignTenantId: string | null = null

    try {
      foreignTenantId = await createTenant(request, superadminToken, `QA AUTH-073 undo tenant ${stamp}`)
      roleId = await createRoleFixture(request, superadminToken, { name: `qa-auth-073-undo-move-${stamp}`, tenantId: foreignTenantId })
      userId = await createUserFixture(request, superadminToken, {
        email: `qa-auth-073-undo-move-${stamp}@example.com`,
        password: 'StrongSecret123!',
        organizationId,
        roles: [],
      })
      const moveResponse = await apiRequest(request, 'PUT', '/api/auth/roles', {
        token: superadminToken,
        data: { id: roleId, tenantId: superadminTenantId },
      })
      expect(moveResponse.status(), await moveResponse.text()).toBe(200)
      const operation = expectOperation(moveResponse, 'role tenant move')
      await assignRole(request, superadminToken, userId, roleId)

      const undoResponse = await undoByToken(request, superadminToken, operation.undoToken)

      expect(undoResponse.status(), await undoResponse.text()).toBe(409)
      expect(await undoResponse.text()).toContain('Role cannot be moved to another tenant while users are assigned')
      expect((await readRole(roleId)).tenant_id).toBe(superadminTenantId)
      expect(await countActiveAssignments(roleId)).toBe(1)
    } finally {
      await deleteUserIfExists(request, superadminToken, userId)
      await deleteRoleIfExists(request, superadminToken, roleId)
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', foreignTenantId)
    }
  })

  test('still renames a role that has no assigned users', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const tenantId = expectId(getTokenScope(adminToken).tenantId, 'Admin token should include tenant id')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const renamed = `qa-auth-073-free-${stamp}-renamed`
    let roleId: string | null = null

    try {
      roleId = await createRoleFixture(request, superadminToken, { name: `qa-auth-073-free-${stamp}`, tenantId })
      const response = await apiRequest(request, 'PUT', '/api/auth/roles', {
        token: superadminToken,
        data: { id: roleId, name: renamed },
      })

      expect(response.status(), await response.text()).toBe(200)
      expect((await readRole(roleId)).name).toBe(renamed)
    } finally {
      await deleteRoleIfExists(request, superadminToken, roleId)
    }
  })
})
