import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectOperation, redoOk, skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'
import { createResourceFixture, deleteResourceIfExists } from './helpers/resourcesFixtures'

export const integrationMeta = { dependsOnModules: ['resources', 'audit_logs'] }

async function readChild(request: APIRequestContext, token: string, path: string, resourceId: string, id: string) {
  const response = await apiRequest(request, 'GET', `${path}?entityId=${encodeURIComponent(resourceId)}&pageSize=100`, { token })
  expect(response.ok()).toBeTruthy()
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response)
  return body?.items?.find((item) => item.id === id)
}

test.describe('TC-RESO-7666: resource child creation timestamps survive undo and redo', () => {
  test.beforeEach(() => skipIfUndoTestsDisabled())

  for (const child of [
    { kind: 'comments', createdAt: 'created_at', fields: { body: 'Timestamp regression note' } },
    { kind: 'activities', createdAt: 'createdAt', fields: { activityType: 'maintenance', subject: 'Timestamp regression activity' } },
  ]) {
    for (const action of ['create-redo', 'delete-undo']) {
      test(`${child.kind} preserve createdAt after ${action}`, async ({ request }) => {
        const token = await getAuthToken(request, 'admin')
        const path = `/api/resources/${child.kind}`
        let resourceId: string | null = null
        let childId: string | null = null

        try {
          resourceId = await createResourceFixture(request, token, `Timestamp regression ${crypto.randomUUID()}`)
          const created = await apiRequest(request, 'POST', path, {
            token,
            data: { entityId: resourceId, ...child.fields },
          })
          expect(created.status()).toBe(201)
          childId = expectId((await readJsonSafe<{ id?: string }>(created))?.id, 'Child id must be returned')
          const before = await readChild(request, token, path, resourceId, childId)
          expect(before).toBeDefined()
          const createdAt = before?.[child.createdAt]
          expect(typeof createdAt).toBe('string')
          expect(Number.isFinite(Date.parse(createdAt as string))).toBe(true)

          if (action === 'create-redo') {
            const operation = expectOperation(created, `${child.kind} create`)
            await undoOk(request, token, operation.undoToken, `${child.kind} undo create`)
            expect(await readChild(request, token, path, resourceId, childId)).toBeUndefined()
            await redoOk(request, token, operation.logId, `${child.kind} redo create`)
          } else {
            const deleted = await apiRequest(request, 'DELETE', `${path}?id=${encodeURIComponent(childId)}`, { token })
            expect(deleted.ok()).toBeTruthy()
            const operation = expectOperation(deleted, `${child.kind} delete`)
            expect(await readChild(request, token, path, resourceId, childId)).toBeUndefined()
            await undoOk(request, token, operation.undoToken, `${child.kind} undo delete`)
          }

          const restored = await readChild(request, token, path, resourceId, childId)
          expect(restored?.id).toBe(childId)
          expect(restored?.[child.createdAt]).toBe(createdAt)
        } finally {
          try {
            if (childId) await apiRequest(request, 'DELETE', `${path}?id=${encodeURIComponent(childId)}`, { token })
          } finally {
            await deleteResourceIfExists(request, token, resourceId)
          }
        }
      })
    }
  }
})
