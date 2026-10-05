import { randomInt } from 'node:crypto'
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import {
  apiRequest,
  getAuthToken,
  withCredentialIsolatedRequest,
} from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient, type IntegrationDbClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { deleteGeneralEntityIfExists, expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type ReplayLogRow = {
  id: string
  undo_token: string
  execution_state: string
}

const REPLAY_RACE_TIMEOUT_MS = 5_000

async function createTenant(request: APIRequestContext, token: string, name: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', {
    token,
    data: { name },
  })
  expect(response.status()).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, 'Tenant create response should include id')
}

async function updateUserName(
  request: APIRequestContext,
  token: string,
  userId: string,
  name: string,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', '/api/auth/users', {
    token,
    data: { id: userId, name },
  })
  expect(response.status(), await response.text()).toBe(200)
}

async function latestReplayLog(userId: string, actorUserId: string): Promise<ReplayLogRow> {
  return withClient(async (client) => {
    const result = await client.query<ReplayLogRow>(
      `select id, undo_token, execution_state
         from action_logs
        where resource_id = $1
          and actor_user_id = $2
          and undo_token is not null
        order by created_at desc
        limit 1`,
      [userId, actorUserId],
    )
    const row = result.rows[0]
    if (!row) throw new Error('[internal] Replayable auth.users.update log was not persisted')
    return row
  })
}

async function undoAction(
  request: APIRequestContext,
  token: string,
  undoToken: string,
): Promise<APIResponse> {
  return apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/undo', {
    token,
    data: { undoToken },
    timeout: REPLAY_RACE_TIMEOUT_MS,
    retryTransport: false,
  })
}

async function redoAction(
  request: APIRequestContext,
  token: string,
  logId: string,
): Promise<APIResponse> {
  return apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/redo', {
    token,
    data: { logId },
    timeout: REPLAY_RACE_TIMEOUT_MS,
    retryTransport: false,
  })
}

async function createReplayableUser(
  request: APIRequestContext,
  token: string,
  input: { email: string; organizationId: string; roles: string[] },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/auth/users', {
    token,
    data: { ...input, sendInviteEmail: true },
  })
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(response.status(), await response.text()).toBe(201)
  return expectId(body?.id, 'Replayable user create response should include id')
}

async function deleteUser(
  request: APIRequestContext,
  token: string,
  userId: string,
): Promise<void> {
  const response = await apiRequest(
    request,
    'DELETE',
    `/api/auth/users?id=${encodeURIComponent(userId)}`,
    { token },
  )
  expect(response.status(), await response.text()).toBe(200)
}

async function raceReplayWithProtectedRoleWriter(
  token: string,
  userId: string,
  roleId: string,
  replay: (request: APIRequestContext) => Promise<APIResponse>,
): Promise<{
  replayResponse: { body: string; status: number }
  writerResponse: { body: string; status: number }
}> {
  return withCredentialIsolatedRequest(async (writerRequest) => (
    withCredentialIsolatedRequest(async (replayRequest) => (
      withClient(async (blocker) => {
        await blocker.query('begin')
        try {
          const blockerPid = Number((await blocker.query<{ pid: number }>(
            'select pg_backend_pid() as pid',
          )).rows[0]?.pid)
          await blocker.query('select id from roles where id = $1 for update', [roleId])
          const pendingWriter = apiRequest(writerRequest, 'PUT', '/api/auth/users', {
            token,
            data: { id: userId, roles: [roleId] },
            timeout: REPLAY_RACE_TIMEOUT_MS,
            retryTransport: false,
          })
          await withClient((observer) => waitUntilBlockedBy(observer, blockerPid))
          const pendingReplay = replay(replayRequest)
          await withClient((observer) => waitUntilBlockedCount(observer, [blockerPid], 2))
          await blocker.query('commit')
          const [writerResponse, replayResponse] = await Promise.all([pendingWriter, pendingReplay])
          return {
            replayResponse: {
              body: await replayResponse.text(),
              status: replayResponse.status(),
            },
            writerResponse: {
              body: await writerResponse.text(),
              status: writerResponse.status(),
            },
          }
        } catch (error) {
          await blocker.query('rollback').catch(() => undefined)
          throw error
        }
      })
    ))
  ))
}

async function readUserState(userId: string): Promise<{
  exists: boolean
  name: string | null
  isConfirmed: boolean | null
}> {
  return withClient(async (client) => {
    const result = await client.query<{ name: string | null; is_confirmed: boolean }>(
      'select name, is_confirmed from users where id = $1',
      [userId],
    )
    return {
      exists: result.rowCount === 1,
      name: result.rows[0]?.name ?? null,
      isConfirmed: result.rows[0]?.is_confirmed ?? null,
    }
  })
}

async function apiKeyRequest(
  request: APIRequestContext,
  method: string,
  path: string,
  secret: string,
  data?: unknown,
): Promise<APIResponse> {
  return request.fetch(path, {
    method,
    headers: {
      'x-api-key': secret,
      'Content-Type': 'application/json',
    },
    data,
    timeout: 5_000,
  })
}

async function updateRoleName(
  request: APIRequestContext,
  token: string,
  roleId: string,
  name: string,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', '/api/auth/roles', {
    token,
    data: { id: roleId, name },
    timeout: 5_000,
    retryTransport: false,
  })
  expect(response.status(), await response.text()).toBe(200)
}

async function updateRoleNameWithApiKey(
  request: APIRequestContext,
  secret: string,
  roleId: string,
  name: string,
): Promise<void> {
  const response = await apiKeyRequest(request, 'PUT', '/api/auth/roles', secret, {
    id: roleId,
    name,
  })
  expect(response.status(), await response.text()).toBe(200)
}

async function createReplayApiKey(
  request: APIRequestContext,
  token: string,
  input: { name: string; roleId: string; organizationId: string },
): Promise<{ id: string; secret: string }> {
  const response = await apiRequest(request, 'POST', '/api/api_keys/keys', {
    token,
    data: {
      name: input.name,
      roles: [input.roleId],
      organizationId: input.organizationId,
    },
  })
  const body = await readJsonSafe<{ id?: string; secret?: string }>(response)
  expect(response.status(), await response.text()).toBe(201)
  return {
    id: expectId(body?.id, 'API-key create response should include id'),
    secret: expectId(body?.secret, 'API-key create response should include secret'),
  }
}

async function updateUserNameWithApiKey(
  request: APIRequestContext,
  secret: string,
  userId: string,
  name: string,
): Promise<void> {
  const response = await apiKeyRequest(request, 'PUT', '/api/auth/users', secret, {
    id: userId,
    name,
  })
  expect(response.status(), await response.text()).toBe(200)
}

async function waitUntilBlockedBy(client: IntegrationDbClient, blockerPid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await client.query<{ blocked: boolean }>(
      `select exists (
         select 1
           from pg_stat_activity activity
          where $1 = any(pg_blocking_pids(activity.pid))
       ) as blocked`,
      [blockerPid],
    )
    if (result.rows[0]?.blocked) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('[internal] Replay request did not reach the expected PostgreSQL row lock')
}

async function waitUntilBlockedCount(
  client: IntegrationDbClient,
  blockerPids: readonly number[],
  expectedCount: number,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await client.query<{ blocked_count: string }>(
      `with recursive blocked(pid) as (
         select activity.pid
           from pg_stat_activity activity
          where pg_blocking_pids(activity.pid) && $1::integer[]
         union
         select activity.pid
           from pg_stat_activity activity
           join blocked blocker
             on blocker.pid = any(pg_blocking_pids(activity.pid))
       )
       select count(*)::text as blocked_count from blocked`,
      [blockerPids],
    )
    if (Number(result.rows[0]?.blocked_count ?? '0') >= expectedCount) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('[internal] Replay contenders did not reach the expected PostgreSQL row locks')
}

async function readReplayState(userId: string, logId: string): Promise<{
  name: string | null
  tenantId: string | null
  executionState: string | null
  logCount: number
}> {
  return withClient(async (client) => {
    const user = await client.query<{ name: string | null; tenant_id: string | null }>(
      'select name, tenant_id from users where id = $1',
      [userId],
    )
    const log = await client.query<{ execution_state: string }>(
      'select execution_state from action_logs where id = $1',
      [logId],
    )
    const count = await client.query<{ count: string }>(
      `select count(*)::text as count
         from action_logs
        where resource_id = $1`,
      [userId],
    )
    return {
      name: user.rows[0]?.name ?? null,
      tenantId: user.rows[0]?.tenant_id ?? null,
      executionState: log.rows[0]?.execution_state ?? null,
      logCount: Number(count.rows[0]?.count ?? '0'),
    }
  })
}

async function readRoleReplayState(roleId: string, logId: string): Promise<{
  name: string | null
  executionState: string | null
  aclCount: number
}> {
  return withClient(async (client) => {
    const role = await client.query<{ name: string | null }>('select name from roles where id = $1', [roleId])
    const log = await client.query<{ execution_state: string }>(
      'select execution_state from action_logs where id = $1',
      [logId],
    )
    const acl = await client.query<{ count: string }>(
      'select count(*)::text as count from role_acls where role_id = $1 and deleted_at is null',
      [roleId],
    )
    return {
      name: role.rows[0]?.name ?? null,
      executionState: log.rows[0]?.execution_state ?? null,
      aclCount: Number(acl.rows[0]?.count ?? '0'),
    }
  })
}

test.describe('TC-AUTH-065: transaction-bound auth replay concurrency', () => {
  test('rechecks a tenant move after the precheck under the mutation transaction lock', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminScope = getTokenScope(adminToken)
    const actorUserId = expectId(adminScope.userId, 'Admin token should include user id')
    const organizationId = expectId(adminScope.organizationId, 'Admin token should include organization id')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    let userId: string | null = null
    let foreignTenantId: string | null = null
    let foreignOrganizationId: string | null = null

    try {
      userId = await createUserFixture(request, adminToken, {
        email: `replay-race-${stamp}@example.com`,
        password: 'StrongSecret123!',
        organizationId,
        roles: [],
      })
      await updateUserName(request, adminToken, userId, 'Replay race after')
      const sourceLog = await latestReplayLog(userId, actorUserId)
      const before = await readReplayState(userId, sourceLog.id)

      foreignTenantId = await createTenant(request, superadminToken, `Replay race tenant ${stamp}`)
      foreignOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `Replay race org ${stamp}`,
        tenantId: foreignTenantId,
      })

      const undoResponse = await withClient(async (blocker) => {
        await blocker.query('begin')
        try {
          const pidResult = await blocker.query<{ pid: number }>('select pg_backend_pid() as pid')
          const blockerPid = pidResult.rows[0]?.pid
          if (!blockerPid) throw new Error('[internal] PostgreSQL blocker pid unavailable')
          await blocker.query(
            'update users set tenant_id = $2, organization_id = $3 where id = $1',
            [userId, foreignTenantId, foreignOrganizationId],
          )
          const pendingUndo = undoAction(request, adminToken, sourceLog.undo_token)
          await withClient((observer) => waitUntilBlockedBy(observer, blockerPid))
          await blocker.query('commit')
          return await pendingUndo
        } catch (error) {
          await blocker.query('rollback').catch(() => undefined)
          throw error
        }
      })

      expect(undoResponse.status(), await undoResponse.text()).toBe(404)
      const state = await readReplayState(userId, sourceLog.id)
      expect(state.tenantId, 'the concurrent tenant move remains committed').toBe(foreignTenantId)
      expect(state.name, 'the replay must not change the encrypted name column').toBe(before.name)
      expect(state.executionState, 'the failed replay rolls the source claim back').toBe('done')
    } finally {
      await deleteUserIfExists(request, superadminToken, userId)
      await deleteOrganizationIfExists(request, superadminToken, foreignOrganizationId)
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', foreignTenantId)
    }
  })

  test('rolls back the domain mutation and source log when finalizing undo fails', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenScope(adminToken)
    const actorUserId = expectId(scope.userId, 'Admin token should include user id')
    const organizationId = expectId(scope.organizationId, 'Admin token should include organization id')
    const stamp = `${Date.now()}_${randomInt(1_000_000)}`
    const functionName = `om_fail_auth_replay_${stamp}`
    const triggerName = `om_fail_auth_replay_trigger_${stamp}`
    let userId: string | null = null

    try {
      userId = await createUserFixture(request, adminToken, {
        email: `replay-rollback-${stamp}@example.com`,
        password: 'StrongSecret123!',
        organizationId,
        roles: [],
      })
      await updateUserName(request, adminToken, userId, 'Replay rollback after')
      const sourceLog = await latestReplayLog(userId, actorUserId)
      const before = await readReplayState(userId, sourceLog.id)

      await withClient(async (client) => {
        await client.query(
          `create function "${functionName}"() returns trigger language plpgsql as $$
           begin
             raise exception 'injected action-log finalization failure';
           end
           $$`,
        )
        await client.query(
          `create trigger "${triggerName}"
             before update on action_logs
             for each row
             when (old.id = '${sourceLog.id}'::uuid and new.execution_state = 'undone')
             execute function "${functionName}"()`,
        )
      })

      const response = await undoAction(request, adminToken, sourceLog.undo_token)
      expect(response.status()).toBe(400)
      const after = await readReplayState(userId, sourceLog.id)
      expect(after.name, 'the encrypted user mutation rolls back with final log state').toBe(before.name)
      expect(after.executionState, 'the source log remains retryable').toBe('done')
      expect(after.logCount, 'the failed undo trace is rolled back').toBe(before.logCount)
    } finally {
      await withClient(async (client) => {
        await client.query(`drop trigger if exists "${triggerName}" on action_logs`)
        await client.query(`drop function if exists "${functionName}"()`)
      }).catch(() => undefined)
      await deleteUserIfExists(request, adminToken, userId)
    }
  })

  test('lets exactly one of two undo contenders commit', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenScope(adminToken)
    const actorUserId = expectId(scope.userId, 'Admin token should include user id')
    const organizationId = expectId(scope.organizationId, 'Admin token should include organization id')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    let userId: string | null = null

    try {
      userId = await createUserFixture(request, adminToken, {
        email: `replay-contenders-${stamp}@example.com`,
        password: 'StrongSecret123!',
        organizationId,
        roles: [],
      })
      await updateUserName(request, adminToken, userId, 'Replay contenders after')
      const sourceLog = await latestReplayLog(userId, actorUserId)
      const before = await readReplayState(userId, sourceLog.id)

      const responses = await Promise.all([
        undoAction(request, adminToken, sourceLog.undo_token),
        undoAction(request, adminToken, sourceLog.undo_token),
      ])
      expect(responses.map((response) => response.status()).sort()).toEqual([200, 409])

      const after = await readReplayState(userId, sourceLog.id)
      expect(after.executionState).toBe('undone')
      expect(after.name, 'the winning undo changes the encrypted name column').not.toBe(before.name)
      expect(after.logCount, 'one committed undo creates exactly one trace log').toBe(before.logCount + 1)
    } finally {
      await deleteUserIfExists(request, adminToken, userId)
    }
  })

  test('serializes inverse user actor-target replays without a deadlock', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenScope(adminToken)
    const tenantId = expectId(scope.tenantId, 'Admin token should include tenant id')
    const organizationId = expectId(scope.organizationId, 'Admin token should include organization id')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const password = 'StrongSecret123!'
    let roleId: string | null = null
    let userAId: string | null = null
    let userBId: string | null = null

    try {
      roleId = await createRoleFixture(request, superadminToken, {
        name: `Replay inverse user role ${stamp}`,
        tenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: ['auth.users.edit', 'audit_logs.undo_self'],
        organizations: null,
      })
      const emailA = `replay-inverse-a-${stamp}@example.com`
      const emailB = `replay-inverse-b-${stamp}@example.com`
      userAId = await createUserFixture(request, superadminToken, {
        email: emailA,
        password,
        organizationId,
        roles: [roleId],
      })
      userBId = await createUserFixture(request, superadminToken, {
        email: emailB,
        password,
        organizationId,
        roles: [roleId],
      })
      const tokenA = await getAuthToken(request, emailA, password)
      const tokenB = await getAuthToken(request, emailB, password)
      await updateUserName(request, tokenA, userBId, 'Inverse user B after')
      await updateUserName(request, tokenB, userAId, 'Inverse user A after')
      const logA = await latestReplayLog(userBId, userAId)
      const logB = await latestReplayLog(userAId, userBId)

      const statuses = await withCredentialIsolatedRequest(async (requestA) => (
        withCredentialIsolatedRequest(async (requestB) => (
          withClient(async (blockerA) => withClient(async (blockerB) => {
            await blockerA.query('begin')
            await blockerB.query('begin')
            try {
              await blockerA.query("set local deadlock_timeout = '200ms'")
              await blockerB.query("set local deadlock_timeout = '200ms'")
              const pidA = Number((await blockerA.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid)
              const pidB = Number((await blockerB.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid)
              await blockerA.query('select id from users where id = $1 for update', [userAId])
              await blockerB.query('select id from users where id = $1 for update', [userBId])
              const pending = [
                undoAction(requestA, tokenA, logA.undo_token),
                undoAction(requestB, tokenB, logB.undo_token),
              ]
              await withClient((observer) => waitUntilBlockedCount(observer, [pidA, pidB], 2))
              await blockerA.query('commit')
              await blockerB.query('commit')
              return (await Promise.all(pending)).map((response) => response.status())
            } catch (error) {
              await blockerA.query('rollback').catch(() => undefined)
              await blockerB.query('rollback').catch(() => undefined)
              throw error
            }
          }))
        ))
      ))

      expect(statuses).toEqual([200, 200])
      const stateA = await readReplayState(userAId, logB.id)
      const stateB = await readReplayState(userBId, logA.id)
      expect(stateA.executionState).toBe('undone')
      expect(stateB.executionState).toBe('undone')
      expect(stateA.name).toBeNull()
      expect(stateB.name).toBeNull()
    } finally {
      await deleteUserIfExists(request, superadminToken, userBId)
      await deleteUserIfExists(request, superadminToken, userAId)
      await deleteRoleIfExists(request, superadminToken, roleId)
    }
  })

  test('serializes inverse API-key role replays with self-only replay grants', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenScope(adminToken)
    const organizationId = expectId(scope.organizationId, 'Admin token should include organization id')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    let roleAId: string | null = null
    let roleBId: string | null = null
    let keyAId: string | null = null
    let keyBId: string | null = null

    try {
      roleAId = await createRoleFixture(request, adminToken, { name: `Replay inverse role A ${stamp}` })
      roleBId = await createRoleFixture(request, adminToken, { name: `Replay inverse role B ${stamp}` })
      for (const roleId of [roleAId, roleBId]) {
        await setRoleAclFeatures(request, adminToken, {
          roleId,
          features: ['auth.roles.manage', 'audit_logs.undo_self'],
          organizations: null,
        })
      }
      const keyA = await createReplayApiKey(request, adminToken, {
        name: `Replay inverse key A ${stamp}`,
        roleId: roleAId,
        organizationId,
      })
      const keyB = await createReplayApiKey(request, adminToken, {
        name: `Replay inverse key B ${stamp}`,
        roleId: roleBId,
        organizationId,
      })
      keyAId = keyA.id
      keyBId = keyB.id
      await updateRoleNameWithApiKey(request, keyA.secret, roleBId, `Replay inverse role B after ${stamp}`)
      await updateRoleNameWithApiKey(request, keyB.secret, roleAId, `Replay inverse role A after ${stamp}`)
      const logA = await latestReplayLog(roleBId, keyA.id)
      const logB = await latestReplayLog(roleAId, keyB.id)

      const statuses = await withCredentialIsolatedRequest(async (requestA) => (
        withCredentialIsolatedRequest(async (requestB) => (
          withClient(async (blockerA) => withClient(async (blockerB) => {
            await blockerA.query('begin')
            await blockerB.query('begin')
            try {
              await blockerA.query("set local deadlock_timeout = '200ms'")
              await blockerB.query("set local deadlock_timeout = '200ms'")
              const pidA = Number((await blockerA.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid)
              const pidB = Number((await blockerB.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid)
              await blockerA.query('select id from api_keys where id = $1 for update', [keyA.id])
              await blockerB.query('select id from api_keys where id = $1 for update', [keyB.id])
              const pending = [
                apiKeyRequest(requestA, 'POST', '/api/audit_logs/audit-logs/actions/undo', keyA.secret, { undoToken: logA.undo_token }),
                apiKeyRequest(requestB, 'POST', '/api/audit_logs/audit-logs/actions/undo', keyB.secret, { undoToken: logB.undo_token }),
              ]
              await withClient((observer) => waitUntilBlockedCount(observer, [pidA, pidB], 2))
              await blockerA.query('commit')
              await blockerB.query('commit')
              return (await Promise.all(pending)).map((response) => response.status())
            } catch (error) {
              await blockerA.query('rollback').catch(() => undefined)
              await blockerB.query('rollback').catch(() => undefined)
              throw error
            }
          }))
        ))
      ))

      expect(statuses).toEqual([200, 200])
      expect((await readRoleReplayState(roleAId, logB.id)).executionState).toBe('undone')
      expect((await readRoleReplayState(roleBId, logA.id)).executionState).toBe('undone')
    } finally {
      await withClient(async (client) => {
        if (keyAId) await client.query('delete from api_keys where id = $1', [keyAId])
        if (keyBId) await client.query('delete from api_keys where id = $1', [keyBId])
      }).catch(() => undefined)
      await deleteRoleIfExists(request, adminToken, roleBId)
      await deleteRoleIfExists(request, adminToken, roleAId)
    }
  })

  test('rejects API-key replay when deletion commits while the replay waits on the key parent', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenScope(adminToken)
    const organizationId = expectId(scope.organizationId, 'Admin token should include organization id')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    let userId: string | null = null
    let roleId: string | null = null
    let apiKeyId: string | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, {
        name: `Replay API key role ${stamp}`,
      })
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: ['auth.users.edit', 'audit_logs.undo_self'],
        organizations: null,
      })
      userId = await createUserFixture(request, adminToken, {
        email: `replay-api-key-${stamp}@example.com`,
        password: 'StrongSecret123!',
        organizationId,
        roles: [],
      })
      const apiKey = await createReplayApiKey(request, adminToken, {
        name: `Replay race key ${stamp}`,
        roleId,
        organizationId,
      })
      apiKeyId = apiKey.id

      await withCredentialIsolatedRequest(async (isolatedRequest) => {
        await updateUserNameWithApiKey(isolatedRequest, apiKey.secret, userId!, 'API key replay after')
        const sourceLog = await latestReplayLog(userId!, apiKey.id)
        const before = await readReplayState(userId!, sourceLog.id)

        const undoResponse = await withClient(async (blocker) => {
          await blocker.query('begin')
          try {
            const pidResult = await blocker.query<{ pid: number }>('select pg_backend_pid() as pid')
            const blockerPid = pidResult.rows[0]?.pid
            if (!blockerPid) throw new Error('[internal] PostgreSQL blocker pid unavailable')
            await blocker.query(
              'update api_keys set deleted_at = now(), updated_at = now() where id = $1',
              [apiKey.id],
            )
            const pendingUndo = apiKeyRequest(
              isolatedRequest,
              'POST',
              '/api/audit_logs/audit-logs/actions/undo',
              apiKey.secret,
              { undoToken: sourceLog.undo_token },
            )
            await withClient((observer) => waitUntilBlockedBy(observer, blockerPid))
            await blocker.query('commit')
            return await pendingUndo
          } catch (error) {
            await blocker.query('rollback').catch(() => undefined)
            throw error
          }
        })

        expect(undoResponse.status(), await undoResponse.text()).toBe(400)
        const after = await readReplayState(userId!, sourceLog.id)
        expect(after.name, 'the deleted API key cannot mutate the target').toBe(before.name)
        expect(after.executionState, 'the denied replay leaves its source retryable').toBe('done')
      })
    } finally {
      if (apiKeyId) {
        await withClient((client) => client.query('delete from api_keys where id = $1', [apiKeyId])).catch(() => undefined)
      }
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  test('rejects replay when a canonical UserRole insertion commits behind the user parent lock', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenScope(adminToken)
    const tenantId = expectId(scope.tenantId, 'Admin token should include tenant id')
    const organizationId = expectId(scope.organizationId, 'Admin token should include organization id')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const password = 'StrongSecret123!'
    let baseRoleId: string | null = null
    let elevatedRoleId: string | null = null
    let actorUserId: string | null = null
    let targetUserId: string | null = null

    try {
      baseRoleId = await createRoleFixture(request, superadminToken, {
        name: `Replay phantom base ${stamp}`,
        tenantId,
      })
      elevatedRoleId = await createRoleFixture(request, superadminToken, {
        name: `Replay phantom elevated ${stamp}`,
        tenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: baseRoleId,
        features: ['auth.users.edit', 'audit_logs.undo_self'],
        organizations: null,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: elevatedRoleId,
        features: ['auth.users.edit', 'audit_logs.undo_self', 'directory.tenants.manage'],
        organizations: null,
      })
      const actorEmail = `replay-phantom-actor-${stamp}@example.com`
      actorUserId = await createUserFixture(request, superadminToken, {
        email: actorEmail,
        password,
        organizationId,
        roles: [baseRoleId],
      })
      targetUserId = await createUserFixture(request, superadminToken, {
        email: `replay-phantom-target-${stamp}@example.com`,
        password,
        organizationId,
        roles: [],
      })
      const actorToken = await getAuthToken(request, actorEmail, password)
      await updateUserName(request, actorToken, targetUserId, 'Phantom membership replay after')
      const sourceLog = await latestReplayLog(targetUserId, actorUserId)
      const before = await readReplayState(targetUserId, sourceLog.id)

      const response = await withClient(async (blocker) => {
        await blocker.query('begin')
        try {
          const blockerPid = Number((await blocker.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid)
          await blocker.query('select id from users where id = $1 for update', [actorUserId])
          await blocker.query('select id from roles where id = $1 for update', [elevatedRoleId])
          await blocker.query(
            'insert into user_roles (id, user_id, role_id, created_at) values (gen_random_uuid(), $1, $2, now())',
            [actorUserId, elevatedRoleId],
          )
          const pending = undoAction(request, actorToken, sourceLog.undo_token)
          await withClient((observer) => waitUntilBlockedBy(observer, blockerPid))
          await blocker.query('commit')
          return pending
        } catch (error) {
          await blocker.query('rollback').catch(() => undefined)
          throw error
        }
      })

      expect(response.status(), await response.text()).toBe(409)
      const after = await readReplayState(targetUserId, sourceLog.id)
      expect(after.name).toBe(before.name)
      expect(after.executionState).toBe('done')
    } finally {
      await deleteUserIfExists(request, superadminToken, targetUserId)
      await deleteUserIfExists(request, superadminToken, actorUserId)
      await deleteRoleIfExists(request, superadminToken, elevatedRoleId)
      await deleteRoleIfExists(request, superadminToken, baseRoleId)
    }
  })

  test('re-reads a RoleAcl insertion after locking its role parent', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenScope(adminToken)
    const tenantId = expectId(scope.tenantId, 'Admin token should include tenant id')
    const actorUserId = expectId(scope.userId, 'Admin token should include user id')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    let roleId: string | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, { name: `Replay ACL phantom ${stamp}` })
      await updateRoleName(request, adminToken, roleId, `Replay ACL phantom after ${stamp}`)
      const sourceLog = await latestReplayLog(roleId, actorUserId)
      const before = await readRoleReplayState(roleId, sourceLog.id)

      const response = await withClient(async (blocker) => {
        await blocker.query('begin')
        try {
          const blockerPid = Number((await blocker.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid)
          await blocker.query('select id from roles where id = $1::uuid for update', [roleId])
          await blocker.query(
            `insert into role_acls
              (id, role_id, tenant_id, features_json, is_super_admin, organizations_json, created_at, updated_at)
             values (gen_random_uuid(), $1, $2, '[]'::jsonb, true, null, now(), now())`,
            [roleId, tenantId],
          )
          const pending = undoAction(request, adminToken, sourceLog.undo_token)
          await withClient((observer) => waitUntilBlockedBy(observer, blockerPid))
          await blocker.query('commit')
          return pending
        } catch (error) {
          await blocker.query('rollback').catch(() => undefined)
          throw error
        }
      })

      expect(response.status(), await response.text()).toBe(403)
      const after = await readRoleReplayState(roleId, sourceLog.id)
      expect(after.name).toBe(before.name)
      expect(after.aclCount).toBe(before.aclCount + 1)
      expect(after.executionState).toBe('done')
    } finally {
      await deleteRoleIfExists(request, superadminToken, roleId)
    }
  })

  test('rejects replay when an API-key role insertion commits behind the role parent lock', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenScope(adminToken)
    const tenantId = expectId(scope.tenantId, 'Admin token should include tenant id')
    const organizationId = expectId(scope.organizationId, 'Admin token should include organization id')
    const actorUserId = expectId(scope.userId, 'Admin token should include user id')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    let roleId: string | null = null
    let apiKeyId: string | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, { name: `Replay API-key phantom ${stamp}` })
      await updateRoleName(request, adminToken, roleId, `Replay API-key phantom after ${stamp}`)
      const sourceLog = await latestReplayLog(roleId, actorUserId)
      const before = await readRoleReplayState(roleId, sourceLog.id)
      apiKeyId = await withClient(async (blocker) => {
        await blocker.query('begin')
        try {
          const blockerPid = Number((await blocker.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid)
          await blocker.query('select id from roles where id = $1 for update', [roleId])
          const insertedId = expectId(
            (await blocker.query<{ id: string }>(
              `insert into api_keys
                (id, name, tenant_id, organization_id, key_hash, key_prefix, roles_json, created_at, updated_at)
               select gen_random_uuid(), $2, $3, $4, 'test-hash', $5, jsonb_build_array($1::text), now(), now()
                 from roles
                where id = $1::uuid
                returning id`,
              [roleId, `Replay API-key phantom ${stamp}`, tenantId, organizationId, `phantom-${stamp}`.slice(0, 12)],
            )).rows[0]?.id,
            'API-key phantom insert should return id',
          )
          const pending = undoAction(request, adminToken, sourceLog.undo_token)
          await withClient((observer) => waitUntilBlockedBy(observer, blockerPid))
          await blocker.query('commit')
          const response = await pending
          expect(response.status(), await response.text()).toBe(409)
          return insertedId
        } catch (error) {
          await blocker.query('rollback').catch(() => undefined)
          throw error
        }
      })

      const after = await readRoleReplayState(roleId, sourceLog.id)
      expect(after.name).toBe(before.name)
      expect(after.executionState).toBe('done')
    } finally {
      if (apiKeyId) {
        await withClient((client) => client.query('delete from api_keys where id = $1', [apiKeyId])).catch(() => undefined)
      }
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  test('serializes inverse protected-role user writers without a deadlock', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenScope(adminToken)
    const tenantId = expectId(scope.tenantId, 'Admin token should include tenant id')
    const organizationId = expectId(scope.organizationId, 'Admin token should include organization id')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    let roleAId: string | null = null
    let roleBId: string | null = null
    let userAId: string | null = null
    let userBId: string | null = null

    try {
      roleAId = await createRoleFixture(request, superadminToken, { name: `Protected inverse A ${stamp}`, tenantId })
      roleBId = await createRoleFixture(request, superadminToken, { name: `Protected inverse B ${stamp}`, tenantId })
      await withClient((client) => client.query(
        'update roles set min_active_holders = 1 where id = any($1::uuid[])',
        [[roleAId, roleBId]],
      ))
      userAId = await createUserFixture(request, superadminToken, {
        email: `protected-inverse-a-${stamp}@example.com`,
        password: 'StrongSecret123!',
        organizationId,
        roles: [roleAId],
      })
      userBId = await createUserFixture(request, superadminToken, {
        email: `protected-inverse-b-${stamp}@example.com`,
        password: 'StrongSecret123!',
        organizationId,
        roles: [roleBId],
      })

      const statuses = await withCredentialIsolatedRequest(async (requestA) => (
        withCredentialIsolatedRequest(async (requestB) => (
          withClient(async (blockerA) => withClient(async (blockerB) => {
            await blockerA.query('begin')
            await blockerB.query('begin')
            try {
              const pidA = Number((await blockerA.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid)
              const pidB = Number((await blockerB.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid)
              await blockerA.query('select id from users where id = $1 for update', [userAId])
              await blockerB.query('select id from users where id = $1 for update', [userBId])
              const pending = [
                apiRequest(requestA, 'PUT', '/api/auth/users', {
                  token: adminToken,
                  data: { id: userAId, roles: [] },
                  timeout: 5_000,
                  retryTransport: false,
                }),
                apiRequest(requestB, 'PUT', '/api/auth/users', {
                  token: adminToken,
                  data: { id: userBId, roles: [] },
                  timeout: 5_000,
                  retryTransport: false,
                }),
              ]
              await withClient((observer) => waitUntilBlockedCount(observer, [pidA, pidB], 2))
              await blockerA.query('commit')
              await blockerB.query('commit')
              return (await Promise.all(pending)).map((response) => response.status())
            } catch (error) {
              await blockerA.query('rollback').catch(() => undefined)
              await blockerB.query('rollback').catch(() => undefined)
              throw error
            }
          }))
        ))
      ))

      expect(statuses).toEqual([400, 400])
    } finally {
      await deleteUserIfExists(request, superadminToken, userBId)
      await deleteUserIfExists(request, superadminToken, userAId)
      await deleteRoleIfExists(request, superadminToken, roleBId)
      await deleteRoleIfExists(request, superadminToken, roleAId)
    }
  })

  for (const scenario of [
    { commandKind: 'create', operation: 'undo' },
    { commandKind: 'update', operation: 'undo' },
    { commandKind: 'update', operation: 'redo' },
    { commandKind: 'delete', operation: 'redo' },
  ] as const) {
    test(`serializes ${scenario.commandKind} ${scenario.operation} against a canonical protected-role writer`, async ({ request }) => {
      const adminToken = await getAuthToken(request, 'admin')
      const superadminToken = await getAuthToken(request, 'superadmin')
      const scope = getTokenScope(adminToken)
      const tenantId = expectId(scope.tenantId, 'Admin token should include tenant id')
      const organizationId = expectId(scope.organizationId, 'Admin token should include organization id')
      const actorUserId = expectId(scope.userId, 'Admin token should include user id')
      const stamp = `${Date.now()}-${randomInt(1_000_000)}`
      let roleId: string | null = null
      let holderUserId: string | null = null
      let targetUserId: string | null = null

      try {
        roleId = await createRoleFixture(request, superadminToken, {
          name: `Replay protected ${scenario.commandKind} ${scenario.operation} ${stamp}`,
          tenantId,
        })
        await withClient((client) => client.query(
          'update roles set min_active_holders = 1 where id = $1',
          [roleId],
        ))
        holderUserId = await createUserFixture(request, superadminToken, {
          email: `replay-protected-holder-${scenario.commandKind}-${scenario.operation}-${stamp}@example.com`,
          password: 'StrongSecret123!',
          organizationId,
          roles: [roleId],
        })
        targetUserId = scenario.commandKind === 'create'
          ? await createReplayableUser(request, adminToken, {
              email: `replay-protected-target-create-undo-${stamp}@example.com`,
              organizationId,
              roles: [roleId],
            })
          : await createUserFixture(request, superadminToken, {
              email: `replay-protected-target-${scenario.commandKind}-${scenario.operation}-${stamp}@example.com`,
              password: 'StrongSecret123!',
              organizationId,
              roles: [roleId],
            })

        if (scenario.commandKind === 'update' && scenario.operation === 'undo') {
          await withClient((client) => client.query(
            'update users set is_confirmed = false where id = $1',
            [targetUserId],
          ))
          const response = await apiRequest(request, 'PUT', '/api/auth/users', {
            token: adminToken,
            data: { id: targetUserId, isConfirmed: true },
          })
          expect(response.status(), await response.text()).toBe(200)
        } else if (scenario.commandKind === 'update') {
          const response = await apiRequest(request, 'PUT', '/api/auth/users', {
            token: adminToken,
            data: { id: targetUserId, isConfirmed: false },
          })
          expect(response.status(), await response.text()).toBe(200)
        } else if (scenario.commandKind === 'delete') {
          await deleteUser(request, adminToken, targetUserId)
        }

        const sourceLog = await latestReplayLog(targetUserId, actorUserId)
        if (scenario.operation === 'redo') {
          const undoResponse = await undoAction(request, adminToken, sourceLog.undo_token)
          expect(undoResponse.status(), await undoResponse.text()).toBe(200)
        }

        const { replayResponse, writerResponse } = await raceReplayWithProtectedRoleWriter(
          adminToken,
          targetUserId,
          roleId,
          (isolatedRequest) => scenario.operation === 'undo'
            ? undoAction(isolatedRequest, adminToken, sourceLog.undo_token)
            : redoAction(isolatedRequest, adminToken, sourceLog.id),
        )

        expect(writerResponse.status, writerResponse.body).toBe(200)
        expect(replayResponse.status, replayResponse.body).toBe(200)
        const userState = await readUserState(targetUserId)
        if (scenario.commandKind === 'create' || scenario.commandKind === 'delete') {
          expect(userState.exists).toBe(false)
        } else {
          expect(userState.exists).toBe(true)
          expect(userState.isConfirmed).toBe(false)
        }
        const replayState = await readReplayState(targetUserId, sourceLog.id)
        expect(replayState.executionState).toBe(scenario.operation === 'undo' ? 'undone' : 'redone')
      } finally {
        if (roleId) {
          await withClient((client) => client.query(
            'update roles set min_active_holders = 0 where id = $1',
            [roleId],
          )).catch(() => undefined)
        }
        await deleteUserIfExists(request, superadminToken, targetUserId)
        await deleteUserIfExists(request, superadminToken, holderUserId)
        await deleteRoleIfExists(request, superadminToken, roleId)
      }
    })
  }

  test('rejects replay when an organization reparent commits before the hierarchy lock', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const tenantId = expectId(getTokenScope(adminToken).tenantId, 'Admin token should include tenant id')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const actorEmail = `replay-org-actor-${stamp}@example.com`
    const actorPassword = 'StrongSecret123!'
    let parentAId: string | null = null
    let parentBId: string | null = null
    let childId: string | null = null
    let roleId: string | null = null
    let actorUserId: string | null = null
    let targetUserId: string | null = null

    try {
      parentAId = await createOrganizationFixture(request, superadminToken, {
        name: `Replay parent A ${stamp}`,
        tenantId,
      })
      parentBId = await createOrganizationFixture(request, superadminToken, {
        name: `Replay parent B ${stamp}`,
        tenantId,
      })
      childId = await createOrganizationFixture(request, superadminToken, {
        name: `Replay child ${stamp}`,
        tenantId,
        parentId: parentAId,
      })
      roleId = await createRoleFixture(request, superadminToken, {
        name: `Replay hierarchy role ${stamp}`,
        tenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: ['auth.users.edit', 'audit_logs.undo_self', 'audit_logs.undo_tenant'],
        organizations: [parentAId],
      })
      actorUserId = await createUserFixture(request, superadminToken, {
        email: actorEmail,
        password: actorPassword,
        organizationId: childId,
        roles: [roleId],
      })
      targetUserId = await createUserFixture(request, superadminToken, {
        email: `replay-org-target-${stamp}@example.com`,
        password: actorPassword,
        organizationId: childId,
        roles: [],
      })
      const actorToken = await getAuthToken(request, actorEmail, actorPassword)
      await updateUserName(request, actorToken, targetUserId, 'Organization replay after')
      const sourceLog = await latestReplayLog(targetUserId, actorUserId)
      const before = await readReplayState(targetUserId, sourceLog.id)

      const undoResponse = await withClient(async (blocker) => {
        await blocker.query('begin')
        try {
          const pidResult = await blocker.query<{ pid: number }>('select pg_backend_pid() as pid')
          const blockerPid = pidResult.rows[0]?.pid
          if (!blockerPid) throw new Error('[internal] PostgreSQL blocker pid unavailable')
          await blocker.query(
            `select id
               from organizations
              where tenant_id = $1 and deleted_at is null
              order by id
              for update`,
            [tenantId],
          )
          await blocker.query(
            `update organizations
                set parent_id = $2::uuid, ancestor_ids = jsonb_build_array($2::text), updated_at = now()
              where id = $1`,
            [childId, parentBId],
          )
          const pendingUndo = undoAction(request, actorToken, sourceLog.undo_token)
          await withClient((observer) => waitUntilBlockedBy(observer, blockerPid))
          await blocker.query('commit')
          return await pendingUndo
        } catch (error) {
          await blocker.query('rollback').catch(() => undefined)
          throw error
        }
      })

      expect(undoResponse.status(), await undoResponse.text()).toBe(400)
      const after = await readReplayState(targetUserId, sourceLog.id)
      expect(after.name, 'the out-of-scope organization cannot be replayed').toBe(before.name)
      expect(after.executionState, 'the denied replay leaves its source retryable').toBe('done')
    } finally {
      await deleteUserIfExists(request, superadminToken, targetUserId)
      await deleteUserIfExists(request, superadminToken, actorUserId)
      await deleteRoleIfExists(request, superadminToken, roleId)
      await deleteOrganizationIfExists(request, superadminToken, childId)
      await deleteOrganizationIfExists(request, superadminToken, parentBId)
      await deleteOrganizationIfExists(request, superadminToken, parentAId)
    }
  })

  test('runs a newly applicable blocking interceptor after a concurrent feature grant', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminScope = getTokenScope(adminToken)
    const tenantId = expectId(adminScope.tenantId, 'Admin token should include tenant id')
    const organizationId = expectId(adminScope.organizationId, 'Admin token should include organization id')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const actorEmail = `replay-feature-actor-${stamp}@example.com`
    const actorPassword = 'StrongSecret123!'
    const baseFeatures = ['auth.users.edit', 'audit_logs.undo_self', 'audit_logs.undo_tenant']
    let roleId: string | null = null
    let actorUserId: string | null = null
    let targetUserId: string | null = null

    try {
      roleId = await createRoleFixture(request, superadminToken, {
        name: `Replay feature role ${stamp}`,
        tenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: baseFeatures,
        organizations: null,
      })
      actorUserId = await createUserFixture(request, superadminToken, {
        email: actorEmail,
        password: actorPassword,
        organizationId,
        roles: [roleId],
      })
      targetUserId = await createUserFixture(request, superadminToken, {
        email: `replay-feature-target-${stamp}@example.com`,
        password: actorPassword,
        organizationId,
        roles: [],
      })
      const actorToken = await getAuthToken(request, actorEmail, actorPassword)
      await updateUserName(request, actorToken, targetUserId, 'Feature replay after')
      const sourceLog = await latestReplayLog(targetUserId, actorUserId)
      const before = await readReplayState(targetUserId, sourceLog.id)

      const undoResponse = await withClient(async (blocker) => {
        await blocker.query('begin')
        try {
          const pidResult = await blocker.query<{ pid: number }>('select pg_backend_pid() as pid')
          const blockerPid = pidResult.rows[0]?.pid
          if (!blockerPid) throw new Error('[internal] PostgreSQL blocker pid unavailable')
          await blocker.query('select id from roles where id = $1 for update', [roleId])
          await blocker.query(
            'update role_acls set features_json = $2::jsonb, updated_at = now() where role_id = $1',
            [roleId, JSON.stringify([...baseFeatures, 'directory.tenants.manage'])],
          )
          const pendingUndo = undoAction(request, actorToken, sourceLog.undo_token)
          await withClient((observer) => waitUntilBlockedBy(observer, blockerPid))
          await blocker.query('commit')
          return await pendingUndo
        } catch (error) {
          await blocker.query('rollback').catch(() => undefined)
          throw error
        }
      })

      expect(undoResponse.status(), await undoResponse.text()).toBe(409)
      const after = await readReplayState(targetUserId, sourceLog.id)
      expect(after.name, 'the newly applicable interceptor blocks the domain mutation').toBe(before.name)
      expect(after.executionState, 'the interceptor rejection rolls the replay claim back').toBe('done')
    } finally {
      await deleteUserIfExists(request, superadminToken, targetUserId)
      await deleteUserIfExists(request, superadminToken, actorUserId)
      await deleteRoleIfExists(request, superadminToken, roleId)
    }
  })
})
