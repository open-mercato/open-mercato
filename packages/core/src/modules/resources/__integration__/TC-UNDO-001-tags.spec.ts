import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createResourceUndoFixture,
  deleteResourceUndoFixture,
  expectResourceUndoTokenConsumed,
  readResourceUndoRecord,
  resourceUndoStamp,
} from '@open-mercato/core/helpers/integration/resourcesUndoFixtures'
import { expectOperation, extractOperation, redoOk, skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'

const RESOURCES = '/api/resources/resources'
const TAGS = '/api/resources/tags'

function tagIds(record: Record<string, unknown> | null): string[] {
  expect(record, 'parent resource is readable').not.toBeNull()
  expect(Array.isArray(record?.tags), 'tags are included in resource response').toBe(true)
  return (record?.tags as Array<{ id: string }>).map((tag) => tag.id).sort()
}

test.describe('TC-UNDO-001 resource tag membership and non-undoable CRUD (#2577)', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  for (const action of ['assign', 'unassign'] as const) {
    test(`${action} undo/redo restores membership and preserves other tags`, async ({ request }) => {
      const token = await getAuthToken(request, 'admin')
      const stamp = resourceUndoStamp()
      const fixtureTagIds: string[] = []
      let resourceId: string | null = null
      try {
        for (const suffix of ['retained', 'target']) {
          fixtureTagIds.push((await createResourceUndoFixture(request, token, TAGS, { label: `Undo ${suffix} ${stamp}` })).id)
        }
        const [retainedId, targetId] = fixtureTagIds
        const initialTags = action === 'assign' ? [retainedId] : [retainedId, targetId]
        resourceId = (await createResourceUndoFixture(request, token, RESOURCES, { name: `Tag undo ${stamp}`, tags: initialTags })).id
        const readTags = async () => tagIds(await readResourceUndoRecord(request, token, RESOURCES, resourceId as string))
        expect(await readTags()).toEqual([...initialTags].sort())

        const changed = await apiRequest(request, 'POST', `${RESOURCES}/tags/${action}`, {
          token, data: { resourceId, tagId: targetId },
        })
        expect(changed.status()).toBe(action === 'assign' ? 201 : 200)
        const operation = expectOperation(changed, `resources.resourceTags.${action}`)
        expect(operation.commandId).toBe(`resources.resourceTags.${action}`)
        const afterTags = action === 'assign' ? [retainedId, targetId] : [retainedId]
        expect(await readTags()).toEqual(afterTags.sort())

        await undoOk(request, token, operation.undoToken, `tag ${action}`)
        expect(await readTags()).toEqual([...initialTags].sort())
        await expectResourceUndoTokenConsumed(request, token, operation.undoToken)
        const redone = await redoOk(request, token, operation.logId, `tag ${action}`)
        expect(await readTags()).toEqual(afterTags)
        expect(redone.undoToken, 'redo issues a fresh undo token').toBeTruthy()
        await undoOk(request, token, redone.undoToken as string, `redone tag ${action}`)
        expect(await readTags()).toEqual([...initialTags].sort())
        await expectResourceUndoTokenConsumed(request, token, redone.undoToken as string)
      } finally {
        if (resourceId) await deleteResourceUndoFixture(request, token, RESOURCES, resourceId)
        for (const tagId of fixtureTagIds.reverse()) await deleteResourceUndoFixture(request, token, TAGS, tagId)
      }
    })
  }

  test('resource update undo/redo restores the complete tag collection', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = resourceUndoStamp()
    const fixtureTagIds: string[] = []
    let resourceId: string | null = null
    try {
      for (const suffix of ['original', 'replacement']) {
        fixtureTagIds.push((await createResourceUndoFixture(request, token, TAGS, { label: `Undo collection ${suffix} ${stamp}` })).id)
      }
      resourceId = (await createResourceUndoFixture(request, token, RESOURCES, { name: `Tag collection undo ${stamp}`, tags: [fixtureTagIds[0]] })).id
      const readTags = async () => tagIds(await readResourceUndoRecord(request, token, RESOURCES, resourceId as string))
      expect(await readTags()).toEqual([fixtureTagIds[0]])
      const updated = await apiRequest(request, 'PUT', RESOURCES, { token, data: { id: resourceId, tags: [fixtureTagIds[1]] } })
      expect(updated.status()).toBe(200)
      const operation = expectOperation(updated, 'resource tag collection update')
      expect(await readTags()).toEqual([fixtureTagIds[1]])
      await undoOk(request, token, operation.undoToken, 'resource tag collection update')
      expect(await readTags()).toEqual([fixtureTagIds[0]])
      await expectResourceUndoTokenConsumed(request, token, operation.undoToken)
      await redoOk(request, token, operation.logId, 'resource tag collection update')
      expect(await readTags()).toEqual([fixtureTagIds[1]])
    } finally {
      if (resourceId) await deleteResourceUndoFixture(request, token, RESOURCES, resourceId)
      for (const tagId of fixtureTagIds.reverse()) await deleteResourceUndoFixture(request, token, TAGS, tagId)
    }
  })

  test('tag create/update/delete expose no undo token (§4)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = resourceUndoStamp()
    let tagId: string | null = null
    try {
      const created = await createResourceUndoFixture(request, token, TAGS, {
        label: `Non-undoable tag ${stamp}`, slug: `undo-${stamp}`, description: 'Original tag', color: '#123456',
      })
      tagId = created.id
      expect(extractOperation(created.response)).toBeNull()
      expect(await readResourceUndoRecord(request, token, TAGS, tagId, { search: stamp })).toMatchObject({ id: tagId, label: `Non-undoable tag ${stamp}` })

      const updated = await apiRequest(request, 'PUT', TAGS, {
        token, data: { id: tagId, label: `Updated tag ${stamp}`, description: 'Updated tag', color: '#654321' },
      })
      expect(updated.status()).toBe(200)
      expect(extractOperation(updated)).toBeNull()
      expect(await readResourceUndoRecord(request, token, TAGS, tagId, { search: stamp })).toMatchObject({ label: `Updated tag ${stamp}`, description: 'Updated tag', color: '#654321' })

      const deleted = await apiRequest(request, 'DELETE', `${TAGS}?id=${tagId}`, { token })
      expect(deleted.status()).toBe(200)
      expect(extractOperation(deleted)).toBeNull()
      expect(await readResourceUndoRecord(request, token, TAGS, tagId, { search: stamp })).toBeNull()
    } finally {
      if (tagId) await deleteResourceUndoFixture(request, token, TAGS, tagId)
    }
  })
})
