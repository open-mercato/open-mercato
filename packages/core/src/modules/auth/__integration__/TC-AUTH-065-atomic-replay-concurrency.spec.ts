import { randomInt } from 'node:crypto'
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteUserIfExists,
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
      expect(responses.map((response) => response.status()).sort()).toEqual([200, 400])

      const after = await readReplayState(userId, sourceLog.id)
      expect(after.executionState).toBe('undone')
      expect(after.name, 'the winning undo changes the encrypted name column').not.toBe(before.name)
      expect(after.logCount, 'one committed undo creates exactly one trace log').toBe(before.logCount + 1)
    } finally {
      await deleteUserIfExists(request, adminToken, userId)
    }
  })
})
