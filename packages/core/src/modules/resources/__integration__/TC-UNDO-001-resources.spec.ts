import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteEntityByPathIfExists, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  assertResourceRowState,
  assertResourceScalarSnapshot,
  createResourceUndoFixture,
  deleteResourceUndoFixture,
  expectResourceUndoTokenConsumed,
  readResourceUndoRecord,
  resourceUndoStamp,
  runResourceUndoLifecycle,
} from '@open-mercato/core/helpers/integration/resourcesUndoFixtures'
import { expectOperation, redoOk, skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'

const RESOURCES = '/api/resources/resources'
const TYPES = '/api/resources/resource-types'
const TAGS = '/api/resources/tags'
const COMMENTS = '/api/resources/comments'
const ACTIVITIES = '/api/resources/activities'
const DEFINITIONS = '/api/entities/definitions'
const scalarFields = [
  'id', 'name', 'description', 'resource_type_id', 'capacity', 'capacity_unit_value',
  'capacity_unit_name', 'capacity_unit_color', 'capacity_unit_icon', 'appearance_icon',
  'appearance_color', 'is_active', 'availability_rule_set_id', 'custom_fieldset_code',
  'organization_id', 'tenant_id', 'created_at',
]

export const integrationMeta = {
  dependsOnModules: ['resources', 'planner', 'dictionaries', 'entities', 'audit_logs'],
}

test.describe('TC-UNDO-001 resources lifecycle and related state (#2577)', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  for (const operation of ['create', 'update', 'delete'] as const) {
    test(`${operation} undo/redo restores the complete resource snapshot`, async ({ request }) => {
      const token = await getAuthToken(request, 'admin')
      const scope = getTokenContext(token)
      const stamp = resourceUndoStamp()
      const typeIds: string[] = []
      const ruleSetIds: string[] = []
      const entryIds: string[] = []
      let dictionaryId: string | null = null
      let dictionaryCreated = false
      let dictionaryWasInactive = false
      const units = [
        { value: `undo-before-${stamp}`, label: `Before unit ${stamp}`, color: '#123456', icon: 'lucide:box' },
        { value: `undo-after-${stamp}`, label: `After unit ${stamp}`, color: '#654321', icon: 'lucide:package' },
      ]
      const fieldsetCodes = [`undo_before_${stamp}`, `undo_after_${stamp}`]
      try {
        const dictionariesResponse = await apiRequest(request, 'GET', '/api/dictionaries?includeInactive=true', { token })
        expect(dictionariesResponse.status()).toBe(200)
        const dictionaries = await readJsonSafe<{
          items: Array<{ id: string; key: string; organizationId: string; isActive: boolean }>
        }>(dictionariesResponse)
        expect(Array.isArray(dictionaries?.items), 'Capacity dictionaries list is readable').toBe(true)
        const dictionary = dictionaries?.items.find((item) => item.key === 'resources.capacity_unit' && item.organizationId === scope.organizationId)
        if (dictionary) {
          dictionaryId = dictionary.id
          if (!dictionary.isActive) {
            dictionaryWasInactive = true
            const activated = await apiRequest(request, 'PATCH', `/api/dictionaries/${dictionaryId}`, { token, data: { isActive: true } })
            expect(activated.status(), 'Temporarily activate the scoped capacity dictionary').toBe(200)
          }
        } else {
          dictionaryId = (await createResourceUndoFixture(request, token, '/api/dictionaries', {
            key: 'resources.capacity_unit', name: `Undo capacity dictionary ${stamp}`, isActive: true, isSystem: false,
          })).id
          dictionaryCreated = true
        }
        for (const unit of units) {
          const fixture = await createResourceUndoFixture(request, token, `/api/dictionaries/${dictionaryId}/entries`, unit)
          entryIds.push(fixture.id)
        }
        for (const suffix of ['before', 'after']) {
          const fixture = await createResourceUndoFixture(request, token, TYPES, { name: `Undo type ${stamp} ${suffix}` })
          typeIds.push(fixture.id)
          const ruleSet = await createResourceUndoFixture(request, token, '/api/planner/availability-rule-sets', {
            name: `Undo availability ${stamp} ${suffix}`, description: `${suffix} availability ${stamp}`, timezone: 'UTC',
          })
          ruleSetIds.push(ruleSet.id)
        }
        await runResourceUndoLifecycle(request, token, operation, {
          collectionPath: RESOURCES,
          commandPrefix: 'resources.resources',
          table: 'resources_resources',
          scope,
          createPayload: {
            name: `Undo resource ${stamp}`, description: 'Before undo coverage', resourceTypeId: typeIds[0],
            capacity: 3, appearanceIcon: 'lucide:box', appearanceColor: '#123456', isActive: true,
            capacityUnitValue: units[0].value, availabilityRuleSetId: ruleSetIds[0], customFieldsetCode: fieldsetCodes[0],
          },
          updatePayload: {
            name: `Updated resource ${stamp}`, description: 'After undo coverage', resourceTypeId: typeIds[1],
            capacity: 7, appearanceIcon: 'lucide:package', appearanceColor: '#654321', isActive: false,
            capacityUnitValue: units[1].value, availabilityRuleSetId: ruleSetIds[1], customFieldsetCode: fieldsetCodes[1],
          },
          expectedCreate: {
            name: `Undo resource ${stamp}`, description: 'Before undo coverage', resource_type_id: typeIds[0], capacity: 3,
            appearance_icon: 'lucide:box', appearance_color: '#123456', is_active: true,
            capacity_unit_value: units[0].value, capacity_unit_name: units[0].label,
            capacity_unit_color: units[0].color, capacity_unit_icon: units[0].icon,
            availability_rule_set_id: ruleSetIds[0], custom_fieldset_code: fieldsetCodes[0],
          },
          expectedUpdate: {
            name: `Updated resource ${stamp}`, description: 'After undo coverage', resource_type_id: typeIds[1], capacity: 7,
            appearance_icon: 'lucide:package', appearance_color: '#654321', is_active: false,
            capacity_unit_value: units[1].value, capacity_unit_name: units[1].label,
            capacity_unit_color: units[1].color, capacity_unit_icon: units[1].icon,
            availability_rule_set_id: ruleSetIds[1], custom_fieldset_code: fieldsetCodes[1],
          },
          scalarFields,
          softDeleteOnCreateUndo: true,
        })
      } finally {
        for (const typeId of typeIds.reverse()) await deleteResourceUndoFixture(request, token, TYPES, typeId)
        for (const ruleSetId of ruleSetIds.reverse()) await deleteResourceUndoFixture(request, token, '/api/planner/availability-rule-sets', ruleSetId)
        for (const entryId of entryIds.reverse()) {
          await deleteEntityByPathIfExists(request, token, `/api/dictionaries/${dictionaryId}/entries/${entryId}`)
        }
        if (dictionaryId && dictionaryCreated) {
          try {
            const renamed = await apiRequest(request, 'PATCH', `/api/dictionaries/${dictionaryId}`, {
              token, data: { key: `undo_capacity_${stamp}` },
            })
            expect(renamed.status(), 'Release the fixed capacity dictionary key before archiving the fixture').toBe(200)
          } finally {
            await deleteEntityByPathIfExists(request, token, `/api/dictionaries/${dictionaryId}`)
          }
        } else if (dictionaryId && dictionaryWasInactive) {
          const restored = await apiRequest(request, 'PATCH', `/api/dictionaries/${dictionaryId}`, { token, data: { isActive: false } })
          expect(restored.status(), 'Restore the original capacity dictionary activation').toBe(200)
        }
      }
    })
  }

  test('custom-field values restore on update/delete undo and redo (I4)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const key = `undo_resource_${resourceUndoStamp().replace(/-/g, '_')}`
    let resourceId: string | null = null
    let definitionCreated = false
    try {
      const definition = await apiRequest(request, 'POST', DEFINITIONS, {
        token,
        data: { entityId: 'resources:resources_resource', key, kind: 'integer', label: `Undo resource ${key}`, formEditable: true, listVisible: true },
      })
      expect(definition.status()).toBe(200)
      definitionCreated = true
      const fixture = await createResourceUndoFixture(request, token, RESOURCES, { name: `CF resource ${key}`, [`cf_${key}`]: 5 })
      resourceId = fixture.id
      const readValue = async () => (await readResourceUndoRecord(request, token, RESOURCES, fixture.id))?.[`cf_${key}`]
      expect(await readValue()).toBe(5)
      const createOperation = expectOperation(fixture.response, 'resources custom fields create')
      await undoOk(request, token, createOperation.undoToken, 'resource custom field create')
      expect(await readResourceUndoRecord(request, token, RESOURCES, resourceId)).toBeNull()
      await expectResourceUndoTokenConsumed(request, token, createOperation.undoToken)
      await redoOk(request, token, createOperation.logId, 'resource custom field create')
      expect(await readValue()).toBe(5)

      const updated = await apiRequest(request, 'PUT', RESOURCES, { token, data: { id: resourceId, [`cf_${key}`]: 10 } })
      expect(updated.status()).toBe(200)
      const updateOperation = expectOperation(updated, 'resources custom fields update')
      expect(await readValue()).toBe(10)
      await undoOk(request, token, updateOperation.undoToken, 'resource custom field update')
      expect(await readValue()).toBe(5)
      await expectResourceUndoTokenConsumed(request, token, updateOperation.undoToken)
      await redoOk(request, token, updateOperation.logId, 'resource custom field update')
      expect(await readValue()).toBe(10)

      const deleted = await apiRequest(request, 'DELETE', `${RESOURCES}?id=${resourceId}`, { token })
      expect(deleted.status()).toBe(200)
      const deleteOperation = expectOperation(deleted, 'resources custom fields delete')
      expect(await readResourceUndoRecord(request, token, RESOURCES, resourceId)).toBeNull()
      await undoOk(request, token, deleteOperation.undoToken, 'resource custom field delete')
      expect(await readValue()).toBe(10)
      await expectResourceUndoTokenConsumed(request, token, deleteOperation.undoToken)
      await redoOk(request, token, deleteOperation.logId, 'resource custom field delete')
      expect(await readResourceUndoRecord(request, token, RESOURCES, resourceId)).toBeNull()
    } finally {
      if (resourceId) await deleteResourceUndoFixture(request, token, RESOURCES, resourceId)
      if (definitionCreated) {
        const cleanup = await apiRequest(request, 'DELETE', DEFINITIONS, {
          token, data: { entityId: 'resources:resources_resource', key },
        })
        expect(cleanup.ok(), 'Custom-field definition cleanup succeeds').toBe(true)
      }
    }
  })

  test('parent delete undo preserves tags, comments, and activities', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = getTokenContext(token)
    const stamp = resourceUndoStamp()
    let tagId: string | null = null
    let resourceId: string | null = null
    let commentId: string | null = null
    let activityId: string | null = null
    try {
      tagId = (await createResourceUndoFixture(request, token, TAGS, { label: `Undo relation ${stamp}` })).id
      resourceId = (await createResourceUndoFixture(request, token, RESOURCES, { name: `Undo relations ${stamp}`, tags: [tagId] })).id
      commentId = (await createResourceUndoFixture(request, token, COMMENTS, { entityId: resourceId, body: `Preserved comment ${stamp}` })).id
      activityId = (await createResourceUndoFixture(request, token, ACTIVITIES, { entityId: resourceId, activityType: 'note', subject: `Preserved activity ${stamp}`, occurredAt: '2026-06-01T12:00:00.000Z' })).id
      const before = await readResourceUndoRecord(request, token, RESOURCES, resourceId)
      const beforeComment = await readResourceUndoRecord(request, token, COMMENTS, commentId, { entityId: resourceId })
      const beforeActivity = await readResourceUndoRecord(request, token, ACTIVITIES, activityId, { entityId: resourceId })
      expect(before?.tags).toEqual([expect.objectContaining({ id: tagId })])
      expect(beforeComment?.body).toBe(`Preserved comment ${stamp}`)
      expect(beforeActivity?.subject).toBe(`Preserved activity ${stamp}`)

      const deleted = await apiRequest(request, 'DELETE', `${RESOURCES}?id=${resourceId}`, { token })
      expect(deleted.status()).toBe(200)
      const operation = expectOperation(deleted, 'parent resource delete')
      await assertResourceRowState('resources_resources', resourceId, scope, true)
      await undoOk(request, token, operation.undoToken, 'parent resource delete')
      await expectResourceUndoTokenConsumed(request, token, operation.undoToken)
      await assertResourceRowState('resources_resources', resourceId, scope, false)
      const restored = await readResourceUndoRecord(request, token, RESOURCES, resourceId)
      assertResourceScalarSnapshot(restored, before, scalarFields, 'parent resource restored')
      expect(restored?.tags).toEqual(before?.tags)
      expect(await readResourceUndoRecord(request, token, COMMENTS, commentId, { entityId: resourceId })).toEqual(beforeComment)
      expect(await readResourceUndoRecord(request, token, ACTIVITIES, activityId, { entityId: resourceId })).toEqual(beforeActivity)

      await redoOk(request, token, operation.logId, 'parent resource delete')
      expect(await readResourceUndoRecord(request, token, RESOURCES, resourceId)).toBeNull()
      await assertResourceRowState('resources_resources', resourceId, scope, true)
    } finally {
      if (activityId) await deleteResourceUndoFixture(request, token, ACTIVITIES, activityId)
      if (commentId) await deleteResourceUndoFixture(request, token, COMMENTS, commentId)
      if (resourceId) await deleteResourceUndoFixture(request, token, RESOURCES, resourceId)
      if (tagId) await deleteResourceUndoFixture(request, token, TAGS, tagId)
    }
  })
})
