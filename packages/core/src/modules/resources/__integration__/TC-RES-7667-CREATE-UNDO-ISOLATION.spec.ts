import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { createRoleFixture, createUserFixture, deleteRoleIfExists, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { createOrganizationInDb, withClient, type IntegrationDbClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { deleteGeneralEntityIfExists, expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectOperation, redoByLogId, redoOk, skipIfUndoTestsDisabled, undoByToken, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'

export const integrationMeta = { dependsOnModules: ['auth', 'directory', 'audit_logs', 'resources'] }

const children = [
  { kind: 'comment', path: '/api/resources/comments', table: 'resources_resource_comments' },
  { kind: 'activity', path: '/api/resources/activities', table: 'resources_resource_activities' },
] as const
const denials = ['permission', 'sibling organization', 'foreign tenant'] as const
const replayFeatures = ['audit_logs.undo_self', 'audit_logs.redo_self', 'audit_logs.undo_tenant', 'audit_logs.redo_tenant']
const resourcesPath = '/api/resources/resources'

type Child = (typeof children)[number]
type Denial = (typeof denials)[number]
type Scope = { tenantId: string; organizationId: string }
type Actor = Scope & { token: string; userId: string }
type ChildFixture = Actor & { resourceId: string; childId: string }
type StoredRow = Record<string, unknown>
type World = {
  tenantIds: string[]
  organizationIds: string[]
  roleIds: string[]
  userIds: string[]
  resources: Array<Actor & { resourceId: string }>
}

async function createTenant(client: IntegrationDbClient, world: World): Promise<string> {
  const tenantId = randomUUID()
  world.tenantIds.push(tenantId)
  await client.query(
    'insert into tenants (id, name, is_active, created_at, updated_at) values ($1, $2, true, now(), now())',
    [tenantId, `Resources isolation ${tenantId}`],
  )
  return tenantId
}

async function createScope(world: World, tenantId: string): Promise<Scope> {
  const organizationId = await createOrganizationInDb({ tenantId, name: `Resources isolation ${randomUUID()}` })
  world.organizationIds.push(organizationId)
  return { tenantId, organizationId }
}

async function createActor(
  request: APIRequestContext,
  bootstrapToken: string,
  world: World,
  scope: Scope,
  canReplay: boolean,
): Promise<Actor> {
  const stamp = randomUUID()
  const roleId = await createRoleFixture(request, bootstrapToken, { name: `resources_isolation_${stamp}`, tenantId: scope.tenantId })
  world.roleIds.push(roleId)
  const aclResponse = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
    token: bootstrapToken,
    data: {
      roleId, tenantId: scope.tenantId, organizations: [scope.organizationId],
      features: ['resources.view', 'resources.manage_resources', ...(canReplay ? replayFeatures : [])],
    },
  })
  expect(aclResponse.status(), 'owned role ACL is configured').toBe(200)
  const email = `resources-isolation-${stamp}@example.com`
  const password = `Resources!9${randomUUID()}`
  const userId = await createUserFixture(request, bootstrapToken, {
    email, password, organizationId: scope.organizationId, roles: [roleId],
  })
  world.userIds.push(userId)
  const token = await withCredentialIsolatedRequest(async (loginRequest) => {
    const actorToken = await getAuthToken(loginRequest, email, password)
    const featureResponse = await apiRequest(loginRequest, 'POST', '/api/auth/feature-check', {
      token: actorToken, data: { features: replayFeatures },
    })
    expect(featureResponse.status(), 'replay grants can be checked as the fixture actor').toBe(200)
    expect(await readJsonSafe(featureResponse), 'effective replay grants match the intended denial boundary').toEqual({
      ok: canReplay, granted: canReplay ? replayFeatures : [], userId,
    })
    return actorToken
  })
  expect(getTokenScope(token)).toMatchObject({ ...scope, userId })
  return { ...scope, userId, token }
}

async function createChild(request: APIRequestContext, world: World, actor: Actor, child: Child) {
  const resourceResponse = await apiRequest(request, 'POST', resourcesPath, {
    token: actor.token, data: { name: `Resources isolation ${randomUUID()}` },
  })
  expect(resourceResponse.status()).toBe(201)
  const resourceId = expectId((await readJsonSafe<{ id?: string }>(resourceResponse))?.id, 'owned resource id')
  world.resources.push({ ...actor, resourceId })
  const response = await apiRequest(request, 'POST', child.path, {
    token: actor.token,
    data: {
      entityId: resourceId, body: `Owned ${child.kind} ${randomUUID()}`,
      ...(child.kind === 'activity' ? { activityType: 'meeting', subject: 'Isolation regression', occurredAt: '2026-10-01T08:30:00Z' } : {}),
    },
  })
  expect(response.status()).toBe(201)
  const childId = expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'owned child id')
  const operation = expectOperation(response, `${child.kind} create`)
  expect(operation.resourceId).toBe(childId)
  return { fixture: { ...actor, resourceId, childId }, operation }
}

async function readState(client: IntegrationDbClient, child: Child, fixture: ChildFixture) {
  const values = [fixture.childId, fixture.tenantId, fixture.organizationId]
  const target = await client.query<{ record: StoredRow }>(
    `select to_jsonb(record) as record from ${child.table} record where id = $1 and tenant_id = $2 and organization_id = $3`,
    values,
  )
  const parent = await client.query<{ record: StoredRow }>(
    'select to_jsonb(record) as record from resources_resources record where id = $1 and tenant_id = $2 and organization_id = $3',
    [fixture.resourceId, fixture.tenantId, fixture.organizationId],
  )
  const logs = await client.query<{ record: StoredRow }>(
    `select to_jsonb(record) as record from action_logs record
     where resource_id = any($1::text[]) and tenant_id = $2 and organization_id = $3 order by id`,
    [[fixture.childId, fixture.resourceId], fixture.tenantId, fixture.organizationId],
  )
  expect(target.rows).toHaveLength(1)
  expect(parent.rows).toHaveLength(1)
  return { child: target.rows[0].record, parent: parent.rows[0].record, logs: logs.rows.map((row) => row.record) }
}

async function cleanup(request: APIRequestContext, bootstrapToken: string, client: IntegrationDbClient, world: World, child: Child) {
  for (const fixture of world.resources) {
    const childrenResponse = await client.query<{ id: string }>(
      `select id from ${child.table} where resource_id = $1 and tenant_id = $2 and organization_id = $3`,
      [fixture.resourceId, fixture.tenantId, fixture.organizationId],
    )
    for (const row of childrenResponse.rows) await deleteGeneralEntityIfExists(request, fixture.token, child.path, row.id)
    await deleteGeneralEntityIfExists(request, fixture.token, resourcesPath, fixture.resourceId)
    await client.query(`delete from ${child.table} where resource_id = $1 and tenant_id = $2 and organization_id = $3`,
      [fixture.resourceId, fixture.tenantId, fixture.organizationId])
    await client.query('delete from resources_resources where id = $1 and tenant_id = $2 and organization_id = $3',
      [fixture.resourceId, fixture.tenantId, fixture.organizationId])
  }
  for (const userId of world.userIds) await deleteUserIfExists(request, bootstrapToken, userId)
  for (const roleId of world.roleIds) await deleteRoleIfExists(request, bootstrapToken, roleId)
  expect((await client.query('select id from users where id = any($1::uuid[])', [world.userIds])).rows, 'owned users are removed').toEqual([])
  expect((await client.query('select id from roles where id = any($1::uuid[])', [world.roleIds])).rows, 'owned roles are removed').toEqual([])
  await client.query('delete from action_logs where tenant_id = any($1::uuid[])', [world.tenantIds])
  await client.query('delete from organizations where id = any($1::uuid[])', [world.organizationIds])
  await client.query('delete from tenants where id = any($1::uuid[])', [world.tenantIds])
}

async function assertDeniedReplay(request: APIRequestContext, child: Child, denial: Denial): Promise<void> {
  const bootstrapToken = await getAuthToken(request, 'superadmin')
  const world: World = { tenantIds: [], organizationIds: [], roleIds: [], userIds: [], resources: [] }
  await withCredentialIsolatedRequest(async (actorRequest) => withClient(async (client) => {
    try {
      const ownerScope = await createScope(world, await createTenant(client, world))
      const deniedScope = denial === 'permission' ? ownerScope : await createScope(
        world, denial === 'foreign tenant' ? await createTenant(client, world) : ownerScope.tenantId,
      )
      const owner = await createActor(request, bootstrapToken, world, ownerScope, true)
      const deniedActor = await createActor(request, bootstrapToken, world, deniedScope, denial !== 'permission')
      const unaffected = await createChild(actorRequest, world, deniedActor, child)
      const target = await createChild(actorRequest, world, owner, child)
      const original = await readState(client, child, target.fixture)
      const unaffectedState = await readState(client, child, unaffected.fixture)
      expect(original.child.deleted_at).toBeNull()
      expect(original.logs.find((log) => log.id === target.operation.logId)).toMatchObject({
        execution_state: 'done', undo_token: target.operation.undoToken, actor_user_id: owner.userId,
      })

      const deniedUndo = await undoByToken(actorRequest, deniedActor.token, target.operation.undoToken)
      expect(deniedUndo.status(), `${denial} undo is rejected`).toBe(denial === 'permission' ? 403 : 400)
      if (denial !== 'permission') expect(await readJsonSafe(deniedUndo)).toMatchObject({ error: 'Undo token not available' })
      expect(await readState(client, child, target.fixture), 'denied undo changes no owner row, log or token').toEqual(original)
      expect(await readState(client, child, unaffected.fixture), 'denied undo changes no caller row, log or token').toEqual(unaffectedState)

      await undoOk(actorRequest, owner.token, target.operation.undoToken, 'owner can still use the token after denial')
      const undone = await readState(client, child, target.fixture)
      expect(undone.child.deleted_at).toEqual(expect.any(String))
      expect(undone.logs.find((log) => log.id === target.operation.logId)?.execution_state).toBe('undone')

      const deniedRedo = await redoByLogId(actorRequest, deniedActor.token, target.operation.logId)
      expect(deniedRedo.status(), `${denial} redo is rejected`).toBe(denial === 'permission' ? 403 : 400)
      if (denial !== 'permission') expect(await readJsonSafe(deniedRedo)).toMatchObject({ error: 'Redo target not available' })
      expect(await readState(client, child, target.fixture), 'denied redo changes no retained owner row, log or token').toEqual(undone)
      expect(await readState(client, child, unaffected.fixture), 'denied redo changes no caller row, log or token').toEqual(unaffectedState)

      const redone = await redoOk(actorRequest, owner.token, target.operation.logId, 'owner can still redo after denial')
      const restored = await readState(client, child, target.fixture)
      expect(restored.child).toEqual({ ...original.child, updated_at: expect.any(String) })
      expect(restored.parent).toEqual(original.parent)
      expect(await readState(client, child, unaffected.fixture)).toEqual(unaffectedState)
      await undoOk(actorRequest, owner.token, expectId(redone.undoToken, 'redo issues a fresh usable token'), 'fresh redo token is usable')
    } finally {
      await cleanup(actorRequest, bootstrapToken, client, world, child)
    }
  }))
}

test.describe('TC-RES-7667-CREATE-UNDO-ISOLATION: denied child create replay preserves state', () => {
  test.beforeEach(() => skipIfUndoTestsDisabled())
  for (const child of children) {
    for (const denial of denials) {
      test(`${child.kind}: ${denial} cannot undo or redo another scoped creation`, async ({ request }) => {
        await assertDeniedReplay(request, child, denial)
      })
    }
  }
})
