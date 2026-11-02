import { randomInt } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { EntityManager } from '@mikro-orm/postgresql'
import { bootstrapFromAppRoot } from '@open-mercato/shared/lib/bootstrap/dynamicLoader'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import type { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { getTransactionLifetime } from '@open-mercato/shared/lib/commands/transaction-lifetime'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createUserFixture,
  createRoleFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { resolveAppRoot } from '@open-mercato/core/helpers/integration/appRoot'

type ReplayRow = {
  execution_state: string
  id: string
  name: string | null
  undo_token: string
}

async function latestReplayRow(userId: string, actorUserId: string): Promise<ReplayRow> {
  return withClient(async (client) => {
    const result = await client.query<ReplayRow>(
      `select log.id, log.undo_token, log.execution_state, usr.name
         from action_logs log
         join users usr on usr.id::text = log.resource_id
        where log.resource_id = $1
          and log.actor_user_id = $2
          and log.undo_token is not null
        order by log.created_at desc
        limit 1`,
      [userId, actorUserId],
    )
    const row = result.rows[0]
    if (!row) throw new Error('[internal] Ambient replay source log was not persisted')
    return row
  })
}

async function replayState(userId: string, logId: string): Promise<Pick<ReplayRow, 'execution_state' | 'name'>> {
  return withClient(async (client) => {
    const result = await client.query<Pick<ReplayRow, 'execution_state' | 'name'>>(
      `select log.execution_state, usr.name
         from action_logs log
         join users usr on usr.id = $1
        where log.id = $2`,
      [userId, logId],
    )
    const row = result.rows[0]
    if (!row) throw new Error('[internal] Ambient replay state is unavailable')
    return row
  })
}

async function countRoleAssignedNotifications(userId: string): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ count: string }>(
      `select count(*)::text as count
         from notifications
        where source_entity_type = 'auth:user'
          and source_entity_id = $1
          and type = 'auth.role.assigned'`,
      [userId],
    )
    return Number(result.rows[0]?.count ?? 0)
  })
}

async function countUserRole(userId: string, roleId: string): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ count: string }>(
      `select count(*)::text as count
         from user_roles
        where user_id = $1
          and role_id = $2
          and deleted_at is null`,
      [userId, roleId],
    )
    return Number(result.rows[0]?.count ?? 0)
  })
}

function runtimeContext(
  container: CommandRuntimeContext['container'],
  scope: ReturnType<typeof getTokenScope>,
): CommandRuntimeContext {
  return {
    container,
    auth: {
      sub: scope.userId,
      tenantId: scope.tenantId,
      orgId: scope.organizationId,
    },
    organizationScope: {
      selectedId: scope.organizationId,
      filterIds: [scope.organizationId],
      allowedIds: [scope.organizationId],
      tenantId: scope.tenantId,
    },
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
  }
}

test.describe.serial('TC-AUTH-066: caller-owned replay transaction lifetime', () => {
  test('keeps ambient undo invisible until the true outer commit', async ({ request }) => {
    test.slow()

    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenScope(adminToken)
    const organizationId = expectId(scope.organizationId, 'Admin token should include organization id')
    const actorUserId = expectId(scope.userId, 'Admin token should include user id')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    let userId: string | null = null

    try {
      userId = await createUserFixture(request, adminToken, {
        email: `ambient-replay-commit-${stamp}@example.com`,
        password: 'StrongSecret123!',
        organizationId,
        roles: [],
      })
      const update = await apiRequest(request, 'PUT', '/api/auth/users', {
        token: adminToken,
        data: { id: userId, name: `Ambient replay after ${stamp}` },
      })
      expect(update.status(), await update.text()).toBe(200)
      const source = await latestReplayRow(userId, actorUserId)

      await bootstrapFromAppRoot(resolveAppRoot())
      const container = await createRequestContainer()
      const commandBus = container.resolve('commandBus') as CommandBus
      const em = container.resolve('em') as EntityManager

      await withAtomicFlush(em, [async () => {
        const transactionLifetime = getTransactionLifetime(em)
        expect(transactionLifetime).not.toBeNull()
        await commandBus.undo(source.undo_token, {
          ...runtimeContext(container, scope),
          transactionalEm: em,
          transactionLifetime: transactionLifetime!,
        })

        expect(await replayState(userId!, source.id)).toEqual({
          execution_state: 'done',
          name: source.name,
        })
      }], { transaction: true, label: 'TC-AUTH-066.commit' })

      const committed = await replayState(userId, source.id)
      expect(committed.execution_state).toBe('undone')
      expect(committed.name).not.toBe(source.name)
    } finally {
      await deleteUserIfExists(request, adminToken, userId)
    }
  })

  test('outer rollback restores the source and releases the replay lease for retry', async ({ request }) => {
    test.slow()

    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenScope(adminToken)
    const organizationId = expectId(scope.organizationId, 'Admin token should include organization id')
    const actorUserId = expectId(scope.userId, 'Admin token should include user id')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const rollbackError = new Error('TC-AUTH-066 deliberate outer rollback')
    let userId: string | null = null

    try {
      userId = await createUserFixture(request, adminToken, {
        email: `ambient-replay-rollback-${stamp}@example.com`,
        password: 'StrongSecret123!',
        organizationId,
        roles: [],
      })
      const update = await apiRequest(request, 'PUT', '/api/auth/users', {
        token: adminToken,
        data: { id: userId, name: `Ambient rollback after ${stamp}` },
      })
      expect(update.status(), await update.text()).toBe(200)
      const source = await latestReplayRow(userId, actorUserId)

      await bootstrapFromAppRoot(resolveAppRoot())
      const container = await createRequestContainer()
      const commandBus = container.resolve('commandBus') as CommandBus
      const em = container.resolve('em') as EntityManager
      const baseCtx = runtimeContext(container, scope)

      await expect(withAtomicFlush(em, [async () => {
        const transactionLifetime = getTransactionLifetime(em)
        await commandBus.undo(source.undo_token, {
          ...baseCtx,
          transactionalEm: em,
          transactionLifetime: transactionLifetime!,
        })
        throw rollbackError
      }], { transaction: true, label: 'TC-AUTH-066.rollback' })).rejects.toBe(rollbackError)

      expect(await replayState(userId, source.id)).toEqual({
        execution_state: 'done',
        name: source.name,
      })

      em.clear()
      await commandBus.undo(source.undo_token, baseCtx)
      const retried = await replayState(userId, source.id)
      expect(retried.execution_state).toBe('undone')
      expect(retried.name).not.toBe(source.name)
    } finally {
      await deleteUserIfExists(request, adminToken, userId)
    }
  })

  test('outer rollback suppresses role-changing redo notifications until a real commit', async ({ request }) => {
    test.slow()

    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenScope(adminToken)
    const organizationId = expectId(scope.organizationId, 'Admin token should include organization id')
    const actorUserId = expectId(scope.userId, 'Admin token should include user id')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const rollbackError = new Error('TC-AUTH-066 deliberate role redo rollback')
    let roleId: string | null = null
    let userId: string | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, { name: `Ambient role ${stamp}` })
      userId = await createUserFixture(request, adminToken, {
        email: `ambient-role-rollback-${stamp}@example.com`,
        password: 'StrongSecret123!',
        organizationId,
        roles: [],
      })
      const update = await apiRequest(request, 'PUT', '/api/auth/users', {
        token: adminToken,
        data: { id: userId, roles: [roleId] },
      })
      expect(update.status(), await update.text()).toBe(200)
      const source = await latestReplayRow(userId, actorUserId)
      const undo = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/undo', {
        token: adminToken,
        data: { undoToken: source.undo_token },
      })
      expect(undo.status(), await undo.text()).toBe(200)
      expect(await countUserRole(userId, roleId)).toBe(0)
      const notificationsBefore = await countRoleAssignedNotifications(userId)

      await bootstrapFromAppRoot(resolveAppRoot())
      const container = await createRequestContainer()
      const commandBus = container.resolve('commandBus') as CommandBus
      const actionLogService = container.resolve('actionLogService') as ActionLogService
      const em = container.resolve('em') as EntityManager
      const sourceLog = await actionLogService.findById(source.id)
      expect(sourceLog).not.toBeNull()

      await expect(withAtomicFlush(em, [async () => {
        const transactionLifetime = getTransactionLifetime(em)
        await commandBus.execute('auth.users.update', {
          input: { id: userId, roles: [roleId] },
          ctx: {
            ...runtimeContext(container, scope),
            transactionalEm: em,
            transactionLifetime: transactionLifetime!,
          },
          redoLogEntry: sourceLog!,
        })
        expect(await countRoleAssignedNotifications(userId!)).toBe(notificationsBefore)
        throw rollbackError
      }], { transaction: true, label: 'TC-AUTH-066.role-redo-rollback' })).rejects.toBe(rollbackError)

      expect((await replayState(userId, source.id)).execution_state).toBe('undone')
      expect(await countUserRole(userId, roleId)).toBe(0)
      expect(await countRoleAssignedNotifications(userId)).toBe(notificationsBefore)

      const retry = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/redo', {
        token: adminToken,
        data: { logId: source.id },
      })
      expect(retry.status(), await retry.text()).toBe(200)
      expect(await countUserRole(userId, roleId)).toBe(1)
      expect(await countRoleAssignedNotifications(userId)).toBe(notificationsBefore + 1)
    } finally {
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
