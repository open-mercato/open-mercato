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
const commentPath = '/api/resources/comments'

test.describe('TC-UNDO-001: resource comment scalar and relation restoration', () => {
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
    test(creationTimestamp ? `${operation} undo/redo preserves the original created_at` : `${operation} undo/redo restores comment scalars and stable author`, async ({ request }) => {
      test.fixme(creationTimestamp, 'https://github.com/open-mercato/open-mercato/issues/7666 — child recreation resets the creation timestamp')
      const token = await getAuthToken(request, 'admin')
      const scope = getTokenContext(token)
      const { userId } = getTokenScope(token)
      const stamp = resourceUndoStamp()
      let resourceId: string | null = null
      try {
        resourceId = (await createResourceUndoFixture(request, token, resourcePath, { name: `Comment undo parent ${stamp}` })).id
        const initial = {
          entityId: resourceId,
          body: `Initial comment ${stamp}`,
          authorUserId: userId,
          appearanceIcon: 'lucide:message-square',
          appearanceColor: '#123456',
        }
        const updated = {
          body: `Updated comment ${stamp}`,
          appearanceIcon: 'lucide:sticky-note',
          appearanceColor: '#654321',
        }
        const relation = {
          resource_id: resourceId,
          author_user_id: userId,
          organization_id: scope.organizationId,
          tenant_id: scope.tenantId,
        }

        await runResourceUndoLifecycle(request, token, operation, {
          collectionPath: commentPath,
          commandPrefix: 'resources.resource-comments',
          table: 'resources_resource_comments',
          scope,
          createPayload: initial,
          updatePayload: updated,
          expectedCreate: {
            ...relation,
            body: initial.body,
            appearance_icon: initial.appearanceIcon,
            appearance_color: initial.appearanceColor,
          },
          expectedUpdate: {
            ...relation,
            body: updated.body,
            appearance_icon: updated.appearanceIcon,
            appearance_color: updated.appearanceColor,
          },
          scalarFields: ['body', 'appearance_icon', 'appearance_color', 'resource_id', 'author_user_id', 'organization_id', 'tenant_id', ...(creationTimestamp || operation === 'update' ? ['created_at'] : [])],
          extraQuery: { entityId: resourceId },
        })
      } finally {
        await deleteResourceUndoFixture(request, token, resourcePath, resourceId)
      }
    })
  }

  test('I3: comment create undo retains a soft-deleted row', async ({ request }) => {
    test.fixme(true, 'https://github.com/open-mercato/open-mercato/issues/7667 — create undo physically removes the child row')
    const token = await getAuthToken(request, 'admin')
    const scope = getTokenContext(token)
    let resourceId: string | null = null
    let commentId: string | null = null
    try {
      resourceId = (await createResourceUndoFixture(request, token, resourcePath, { name: `Comment soft-delete parent ${resourceUndoStamp()}` })).id
      const created = await createResourceUndoFixture(request, token, commentPath, {
        entityId: resourceId,
        body: `Soft-delete comment ${resourceUndoStamp()}`,
      })
      commentId = created.id
      const operation = expectOperation(created.response, 'resources.resource-comments.create')
      await undoOk(request, token, operation.undoToken, 'comment create undo soft-deletion')
      expect(await readResourceUndoRecord(request, token, commentPath, commentId, { entityId: resourceId })).toBeNull()
      await assertResourceRowState('resources_resource_comments', commentId, scope, true)
    } finally {
      await deleteResourceUndoFixture(request, token, commentPath, commentId)
      await deleteResourceUndoFixture(request, token, resourcePath, resourceId)
    }
  })
})
