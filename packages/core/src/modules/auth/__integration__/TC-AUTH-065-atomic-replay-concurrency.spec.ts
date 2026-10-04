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
  })
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
        features: ['auth.users.edit', 'audit_logs.undo_self', 'audit_logs.undo_tenant'],
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
