import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  assertResourceRowState,
  createResourceUndoFixture,
  deleteResourceUndoFixture,
  readResourceUndoRecord,
  resourceUndoStamp,
  runResourceUndoLifecycle,
} from '@open-mercato/core/helpers/integration/resourcesUndoFixtures'
import { expectOperation, skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'

const resourcePath = '/api/resources/resources'
const activityPath = '/api/resources/activities'

test.describe('TC-UNDO-001: resource activity scalar and relation restoration', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  const lifecycleCases = [
    { operation: 'create', creationTimestamp: false },
    { operation: 'update', creationTimestamp: false },
    { operation: 'delete', creationTimestamp: false },
    { operation: 'create', creationTimestamp: true },
    { operation: 'delete', creationTimestamp: true },
  ] as const

  for (const { operation, creationTimestamp } of lifecycleCases) {
    test(creationTimestamp ? `${operation} undo/redo preserves the original createdAt` : `${operation} undo/redo restores activity scalars and stable author`, async ({ request }) => {
      test.fixme(creationTimestamp, 'https://github.com/open-mercato/open-mercato/issues/7666 — child recreation resets the creation timestamp')
      const token = await getAuthToken(request, 'admin')
      const scope = getTokenContext(token)
      const { userId } = getTokenScope(token)
      const stamp = resourceUndoStamp()
      let resourceId: string | null = null
      try {
        resourceId = (await createResourceUndoFixture(request, token, resourcePath, { name: `Activity undo parent ${stamp}` })).id
        const initial = {
          entityId: resourceId,
          activityType: 'inspection',
          subject: `Inspection ${stamp}`,
          body: `Initial inspection details ${stamp}`,
          occurredAt: '2026-01-12T10:30:00.000Z',
          authorUserId: userId,
          appearanceIcon: 'lucide:clipboard',
          appearanceColor: '#123456',
        }
        const updated = {
          activityType: 'maintenance',
          subject: `Maintenance ${stamp}`,
          body: `Updated maintenance details ${stamp}`,
          occurredAt: '2026-02-15T14:45:00.000Z',
          appearanceIcon: 'lucide:wrench',
          appearanceColor: '#654321',
        }
        const relation = {
          entityId: resourceId,
          resourceId,
          authorUserId: userId,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
        }

        await runResourceUndoLifecycle(request, token, operation, {
          collectionPath: activityPath,
          commandPrefix: 'resources.resource-activities',
          table: 'resources_resource_activities',
          scope,
          createPayload: initial,
          updatePayload: updated,
          expectedCreate: { ...initial, ...relation },
          expectedUpdate: { ...updated, ...relation },
          scalarFields: ['activityType', 'subject', 'body', 'occurredAt', 'appearanceIcon', 'appearanceColor', 'entityId', 'resourceId', 'authorUserId', 'organizationId', 'tenantId', ...(creationTimestamp || operation === 'update' ? ['createdAt'] : [])],
          extraQuery: { entityId: resourceId },
        })
      } finally {
        await deleteResourceUndoFixture(request, token, resourcePath, resourceId)
      }
    })
  }

  test('I3: activity create undo retains a soft-deleted row', async ({ request }) => {
    test.fixme(true, 'https://github.com/open-mercato/open-mercato/issues/7667 — create undo physically removes the child row')
    const token = await getAuthToken(request, 'admin')
    const scope = getTokenContext(token)
    let resourceId: string | null = null
    let activityId: string | null = null
    try {
      resourceId = (await createResourceUndoFixture(request, token, resourcePath, { name: `Activity soft-delete parent ${resourceUndoStamp()}` })).id
      const created = await createResourceUndoFixture(request, token, activityPath, {
        entityId: resourceId,
        activityType: 'inspection',
        subject: `Soft-delete activity ${resourceUndoStamp()}`,
      })
      activityId = created.id
      const operation = expectOperation(created.response, 'resources.resource-activities.create')
      await undoOk(request, token, operation.undoToken, 'activity create undo soft-deletion')
      expect(await readResourceUndoRecord(request, token, activityPath, activityId, { entityId: resourceId })).toBeNull()
      await assertResourceRowState('resources_resource_activities', activityId, scope, true)
    } finally {
      await deleteResourceUndoFixture(request, token, activityPath, activityId)
      await deleteResourceUndoFixture(request, token, resourcePath, resourceId)
    }
  })
})
