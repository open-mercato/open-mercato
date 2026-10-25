import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createResourceUndoFixture,
  deleteResourceUndoFixture,
  expectResourceUndoTokenConsumed,
  readResourceUndoRecord,
  resourceUndoStamp,
  runResourceUndoLifecycle,
} from '@open-mercato/core/helpers/integration/resourcesUndoFixtures'
import { expectOperation, redoOk, skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'

export const integrationMeta = {
  dependsOnModules: ['resources', 'entities', 'audit_logs'],
}

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

  test('custom-field values restore on create/update/delete undo and redo (I4)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const key = `undo_resource_type_${resourceUndoStamp().replace(/-/g, '_')}`
    const entityId = 'resources:resources_resource_type'
    const resourceTypesPath = '/api/resources/resource-types'
    const definitionsPath = '/api/entities/definitions'
    let resourceTypeId: string | null = null
    let definitionCreated = false
    try {
      const definition = await apiRequest(request, 'POST', definitionsPath, {
        token,
        data: { entityId, key, kind: 'integer', label: `Undo resource type ${key}`, formEditable: true, listVisible: true },
      })
      expect(definition.status()).toBe(200)
      definitionCreated = true
      const fixture = await createResourceUndoFixture(request, token, resourceTypesPath, {
        name: `CF resource type ${key}`, [`cf_${key}`]: 5,
      })
      resourceTypeId = fixture.id
      const readValue = async () => (await readResourceUndoRecord(request, token, resourceTypesPath, fixture.id))?.[`cf_${key}`]
      expect(await readValue()).toBe(5)
      const createOperation = expectOperation(fixture.response, 'resource type custom fields create')
      expect(createOperation.resourceId).toBe(resourceTypeId)
      await undoOk(request, token, createOperation.undoToken, 'resource type custom field create')
      expect(await readResourceUndoRecord(request, token, resourceTypesPath, resourceTypeId)).toBeNull()
      await expectResourceUndoTokenConsumed(request, token, createOperation.undoToken)
      await redoOk(request, token, createOperation.logId, 'resource type custom field create')
      expect(await readValue()).toBe(5)

      const updated = await apiRequest(request, 'PUT', resourceTypesPath, {
        token, data: { id: resourceTypeId, [`cf_${key}`]: 10 },
      })
      expect(updated.status()).toBe(200)
      const updateOperation = expectOperation(updated, 'resource type custom fields update')
      expect(updateOperation.resourceId).toBe(resourceTypeId)
      expect(await readValue()).toBe(10)
      await undoOk(request, token, updateOperation.undoToken, 'resource type custom field update')
      expect(await readValue()).toBe(5)
      await expectResourceUndoTokenConsumed(request, token, updateOperation.undoToken)
      await redoOk(request, token, updateOperation.logId, 'resource type custom field update')
      expect(await readValue()).toBe(10)

      const deleted = await apiRequest(request, 'DELETE', `${resourceTypesPath}?id=${resourceTypeId}`, { token })
      expect(deleted.status()).toBe(200)
      const deleteOperation = expectOperation(deleted, 'resource type custom fields delete')
      expect(deleteOperation.resourceId).toBe(resourceTypeId)
      expect(await readResourceUndoRecord(request, token, resourceTypesPath, resourceTypeId)).toBeNull()
      await undoOk(request, token, deleteOperation.undoToken, 'resource type custom field delete')
      expect(await readValue()).toBe(10)
      await expectResourceUndoTokenConsumed(request, token, deleteOperation.undoToken)
      await redoOk(request, token, deleteOperation.logId, 'resource type custom field delete')
      expect(await readResourceUndoRecord(request, token, resourceTypesPath, resourceTypeId)).toBeNull()
    } finally {
      await deleteResourceUndoFixture(request, token, resourceTypesPath, resourceTypeId)
      if (definitionCreated) {
        const cleanup = await apiRequest(request, 'DELETE', definitionsPath, { token, data: { entityId, key } })
        expect(cleanup.ok(), 'Resource-type custom-field definition cleanup succeeds').toBe(true)
      }
    }
  })
})
