import { test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { resourceUndoStamp, runResourceUndoLifecycle } from '@open-mercato/core/helpers/integration/resourcesUndoFixtures'
import { skipIfUndoTestsDisabled } from '@open-mercato/core/helpers/integration/undoHarness'

test.describe('TC-UNDO-001: resource-type scalar restoration', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  for (const operation of ['create', 'update', 'delete'] as const) {
    test(`${operation} undo and redo restore all resource-type scalars`, async ({ request }) => {
      const token = await getAuthToken(request, 'admin')
      const scope = getTokenContext(token)
      const stamp = resourceUndoStamp()
      const initial = {
        name: `Undo resource type ${stamp}`,
        description: `Initial type description ${stamp}`,
        appearanceIcon: 'lucide:box',
        appearanceColor: '#123456',
      }
      const updated = {
        name: `Updated resource type ${stamp}`,
        description: `Updated type description ${stamp}`,
        appearanceIcon: 'lucide:package',
        appearanceColor: '#654321',
      }

      await runResourceUndoLifecycle(request, token, operation, {
        collectionPath: '/api/resources/resource-types',
        commandPrefix: 'resources.resourceTypes',
        table: 'resources_resource_types',
        scope,
        createPayload: initial,
        updatePayload: updated,
        expectedCreate: {
          name: initial.name,
          description: initial.description,
          appearance_icon: initial.appearanceIcon,
          appearance_color: initial.appearanceColor,
          organization_id: scope.organizationId,
          tenant_id: scope.tenantId,
          resourceCount: 0,
        },
        expectedUpdate: {
          name: updated.name,
          description: updated.description,
          appearance_icon: updated.appearanceIcon,
          appearance_color: updated.appearanceColor,
          organization_id: scope.organizationId,
          tenant_id: scope.tenantId,
          resourceCount: 0,
        },
        scalarFields: ['name', 'description', 'appearance_icon', 'appearance_color', 'organization_id', 'tenant_id', 'resourceCount', 'created_at'],
        extraQuery: { withResourceCounts: 'true' },
        softDeleteOnCreateUndo: true,
      })
    })
  }
})
