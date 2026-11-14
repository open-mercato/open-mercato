import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient, type IntegrationDbClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  expectOperation,
  redoOk,
  skipIfUndoTestsDisabled,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness'

const RESOURCES_PATH = '/api/resources/resources'
const childCases = [
  { kind: 'comment', path: '/api/resources/comments', table: 'resources_resource_comments' },
  { kind: 'activity', path: '/api/resources/activities', table: 'resources_resource_activities' },
] as const

type ChildCase = (typeof childCases)[number]
type ResourceTable = ChildCase['table'] | 'resources_resources'
type Scope = ReturnType<typeof getTokenScope>
type StoredRow = Record<string, unknown>

async function readScopedRow(
  client: IntegrationDbClient,
  table: ResourceTable,
  id: string,
  scope: Scope,
): Promise<StoredRow | null> {
  const result = await client.query<{ record: StoredRow }>(
    `select to_jsonb(record) as record from ${table} as record
     where id = $1 and tenant_id = $2 and organization_id = $3`,
    [id, scope.tenantId, scope.organizationId],
  )
  return result.rows[0]?.record ?? null
}

function retainedValues(row: StoredRow, preserveCreatedAt = true): StoredRow {
  return Object.fromEntries(Object.entries(row).filter(([key]) => (
    key !== 'deleted_at' && key !== 'updated_at' && (preserveCreatedAt || key !== 'created_at')
  )))
}

async function expectListIds(
  request: APIRequestContext,
  token: string,
  child: ChildCase,
  resourceId: string,
  expectedIds: string[],
): Promise<void> {
  await expect.poll(async () => {
    const response = await apiRequest(
      request,
      'GET',
      `${child.path}?entityId=${encodeURIComponent(resourceId)}&pageSize=100`,
      { token },
    )
    expect(response.status(), `${child.kind} list succeeds`).toBe(200)
    const payload = await readJsonSafe<{ items?: Array<{ id: string }> }>(response)
    expect(Array.isArray(payload?.items), `${child.kind} list returns items`).toBe(true)
    return (payload?.items ?? []).map((item) => item.id).sort()
  }, { message: `${child.kind} list contains exactly the visible fixture children` }).toEqual([...expectedIds].sort())
}

test.describe('TC-RES-7667-CREATE-UNDO: resource child create undo retains the original row', () => {
  test.beforeEach(() => {
    skipIfUndoTestsDisabled()
  })

  for (const child of childCases) {
    test(`${child.kind} create undo and repeated redo retain identity, values and references`, async ({ request }) => {
      const token = await getAuthToken(request, 'admin')
      const scope = getTokenScope(token)
      expectId(scope.tenantId, 'authenticated tenant is available')
      expectId(scope.organizationId, 'authenticated organization is available')
      expectId(scope.userId, 'authenticated author is available')
      const stamp = randomUUID()
      let resourceId: string | null = null
      let targetId: string | null = null
      let siblingId: string | null = null

      await withClient(async (client) => {
        try {
          const resourceResponse = await apiRequest(request, 'POST', RESOURCES_PATH, {
            token,
            data: { name: `QA resource child retention ${stamp}` },
          })
          expect(resourceResponse.status(), 'parent resource is created').toBe(201)
          resourceId = expectId((await readJsonSafe<{ id?: string }>(resourceResponse))?.id, 'parent resource id')

          const commonPayload = {
            entityId: resourceId,
            authorUserId: scope.userId,
            appearanceIcon: 'lucide:message-square',
            appearanceColor: '#336699',
          }
          const activityPayload = child.kind === 'activity'
            ? { activityType: 'meeting', subject: `Retention subject ${stamp}`, occurredAt: '2026-10-01T08:30:00.000Z' }
            : {}
          const siblingResponse = await apiRequest(request, 'POST', child.path, {
            token,
            data: { ...commonPayload, ...activityPayload, body: `Unaffected sibling ${stamp}` },
          })
          expect(siblingResponse.status(), 'sibling child is created').toBe(201)
          siblingId = expectId((await readJsonSafe<{ id?: string }>(siblingResponse))?.id, 'sibling child id')

          const body = `Retained ${child.kind} ${stamp}`
          const createResponse = await apiRequest(request, 'POST', child.path, {
            token,
            data: { ...commonPayload, ...activityPayload, body },
          })
          expect(createResponse.status(), 'target child is created').toBe(201)
          const created = await readJsonSafe<{ id?: string; authorUserId?: string }>(createResponse)
          targetId = expectId(created?.id, 'target child id')
          expect(created?.authorUserId, 'create response retains the author contract').toBe(scope.userId)
          const createOperation = expectOperation(createResponse, `${child.kind} create`)
          expect(createOperation.resourceId, 'create operation identifies the target child').toBe(targetId)

          const original = await readScopedRow(client, child.table, targetId, scope)
          const sibling = await readScopedRow(client, child.table, siblingId, scope)
          const parent = await readScopedRow(client, 'resources_resources', resourceId, scope)
          expect(original, 'created child exists in its authenticated database scope').not.toBeNull()
          expect(sibling, 'sibling exists in its authenticated database scope').not.toBeNull()
          expect(parent, 'parent exists in its authenticated database scope').not.toBeNull()
          expect(original).toMatchObject({
            id: targetId,
            tenant_id: scope.tenantId,
            organization_id: scope.organizationId,
            resource_id: resourceId,
            author_user_id: scope.userId,
            body,
            appearance_icon: commonPayload.appearanceIcon,
            appearance_color: commonPayload.appearanceColor,
            created_at: expect.any(String),
            deleted_at: null,
          })
          if (child.kind === 'activity') {
            expect(original).toMatchObject({ activity_type: 'meeting', subject: activityPayload.subject })
            expect(new Date(String(original?.occurred_at)).toISOString()).toBe(activityPayload.occurredAt)
          }
          await expectListIds(request, token, child, resourceId, [targetId, siblingId])

          let operation = { logId: createOperation.logId, undoToken: createOperation.undoToken }
          for (const cycle of [1, 2]) {
            await undoOk(request, token, operation.undoToken, `${child.kind} create undo cycle ${cycle}`)
            const undone = await readScopedRow(client, child.table, targetId, scope)
            expect(undone, 'undo retains the original scoped database row').not.toBeNull()
            expect(undone?.deleted_at, 'undo sets the deletion marker').toEqual(expect.any(String))
            expect(retainedValues(undone!), 'undo retains every stored scalar and reference, including created_at')
              .toEqual(retainedValues(original!))
            await expectListIds(request, token, child, resourceId, [siblingId])
            expect(await readScopedRow(client, child.table, siblingId, scope), 'undo leaves the sibling unchanged').toEqual(sibling)
            expect(await readScopedRow(client, 'resources_resources', resourceId, scope), 'undo leaves the parent unchanged').toEqual(parent)

            const redone = await redoOk(request, token, operation.logId, `${child.kind} create redo cycle ${cycle}`)
            const restored = await readScopedRow(client, child.table, targetId, scope)
            expect(restored, 'redo restores the original scoped child id').not.toBeNull()
            expect(restored?.deleted_at, 'redo clears the deletion marker').toBeNull()
            expect(retainedValues(restored!), 'redo retains every stored scalar and reference, including created_at')
              .toEqual(retainedValues(original!))
            await expectListIds(request, token, child, resourceId, [targetId, siblingId])
            expect(await readScopedRow(client, child.table, siblingId, scope), 'redo leaves the sibling unchanged').toEqual(sibling)
            expect(await readScopedRow(client, 'resources_resources', resourceId, scope), 'redo leaves the parent unchanged').toEqual(parent)
            operation = {
              logId: expectId(redone.logId, 'redo returns a log id for the next cycle'),
              undoToken: expectId(redone.undoToken, 'redo returns an undo token for the next cycle'),
            }
          }

          const deleteResponse = await apiRequest(request, 'DELETE', `${child.path}?id=${encodeURIComponent(targetId)}`, { token })
          expect(deleteResponse.ok(), 'ordinary child delete succeeds').toBe(true)
          const deleteOperation = expectOperation(deleteResponse, `${child.kind} ordinary delete`)
          expect(await readScopedRow(client, child.table, targetId, scope), 'ordinary delete keeps its existing physical-delete behavior').toBeNull()
          await expectListIds(request, token, child, resourceId, [siblingId])
          expect(await readScopedRow(client, child.table, siblingId, scope), 'ordinary delete leaves the sibling unchanged').toEqual(sibling)
          expect(await readScopedRow(client, 'resources_resources', resourceId, scope), 'ordinary delete leaves the parent unchanged').toEqual(parent)

          await undoOk(request, token, deleteOperation.undoToken, `${child.kind} ordinary delete undo`)
          const deleteRestored = await readScopedRow(client, child.table, targetId, scope)
          expect(deleteRestored, 'ordinary delete undo recreates the same child id').not.toBeNull()
          expect(deleteRestored?.deleted_at, 'ordinary delete undo restores a visible child').toBeNull()
          expect(retainedValues(deleteRestored!, false), 'ordinary delete undo retains its existing scalar/reference restoration')
            .toEqual(retainedValues(original!, false))
          await expectListIds(request, token, child, resourceId, [targetId, siblingId])
          expect(await readScopedRow(client, child.table, siblingId, scope), 'ordinary delete cycle leaves the sibling unchanged').toEqual(sibling)
          expect(await readScopedRow(client, 'resources_resources', resourceId, scope), 'ordinary delete cycle leaves the parent unchanged').toEqual(parent)
        } finally {
          await deleteGeneralEntityIfExists(request, token, child.path, targetId)
          await deleteGeneralEntityIfExists(request, token, child.path, siblingId)
          await deleteGeneralEntityIfExists(request, token, RESOURCES_PATH, resourceId)
          if (resourceId) {
            await client.query(
              `delete from ${child.table} where resource_id = $1 and tenant_id = $2 and organization_id = $3`,
              [resourceId, scope.tenantId, scope.organizationId],
            )
            await client.query(
              'delete from resources_resources where id = $1 and tenant_id = $2 and organization_id = $3',
              [resourceId, scope.tenantId, scope.organizationId],
            )
          }
        }
      })
    })
  }
})
