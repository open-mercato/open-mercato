import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  expectOperation,
  redoOk,
  skipIfUndoTestsDisabled,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-RESO-011: undo/redo of a resource still works after a tag recorded in its snapshot was deleted.
 *
 * Deleting a resource tag hard-deletes the tag row and its assignments, and has no undo. Replaying an
 * older resource snapshot that still lists that tag (update undo, delete undo, create redo) must restore
 * the resource and keep the tags that still exist instead of failing with
 * "One or more tags not found for this scope". A live update naming the deleted tag must still 400.
 * Reads use a unique `probe` query param so the CRUD list cache never answers them.
 * Self-contained: tags and resources are created via API and removed in teardown.
 */

const RESOURCES = '/api/resources/resources'
const TAGS = '/api/resources/tags'

let probe = 0

async function createTag(request: APIRequestContext, token: string, label: string): Promise<string> {
  const res = await apiRequest(request, 'POST', TAGS, { token, data: { label } })
  expect(res.status(), `tag create (${label})`).toBe(201)
  const body = (await readJsonSafe(res)) as { id?: string } | null
  expect(typeof body?.id, 'tag create returns an id').toBe('string')
  return body!.id as string
}

async function deleteTag(request: APIRequestContext, token: string, tagId: string): Promise<void> {
  const res = await apiRequest(request, 'DELETE', `${TAGS}?id=${encodeURIComponent(tagId)}`, { token })
  expect(res.ok(), `tag delete status ${res.status()}`).toBeTruthy()
}

async function readResource(request: APIRequestContext, token: string, resourceId: string): Promise<Record<string, unknown> | null> {
  probe += 1
  const query = `ids=${encodeURIComponent(resourceId)}&probe=${Date.now()}-${probe}`
  const res = await apiRequest(request, 'GET', `${RESOURCES}?${query}`, { token })
  expect(res.ok(), `resource list status ${res.status()}`).toBeTruthy()
  const body = (await readJsonSafe(res)) as { items?: Array<Record<string, unknown>> } | null
  return (body?.items ?? []).find((item) => item.id === resourceId) ?? null
}

function tagIdsOf(resource: Record<string, unknown>): string[] {
  const tags = Array.isArray(resource.tags) ? (resource.tags as Array<{ id?: string }>) : []
  return tags
    .map((tag) => (typeof tag?.id === 'string' ? tag.id : null))
    .filter((id): id is string => typeof id === 'string')
    .sort((left, right) => left.localeCompare(right))
}

async function cleanup(request: APIRequestContext, token: string | null, resourceIds: string[], tagIds: string[]): Promise<void> {
  if (!token) return
  for (const id of resourceIds) {
    await apiRequest(request, 'DELETE', `${RESOURCES}?id=${encodeURIComponent(id)}`, { token }).catch(() => {})
  }
  for (const id of tagIds) {
    await apiRequest(request, 'DELETE', `${TAGS}?id=${encodeURIComponent(id)}`, { token }).catch(() => {})
  }
}

test.describe('TC-RESO-011: resource undo/redo after a snapshot tag was deleted', () => {
  test.beforeEach(() => {
    skipIfUndoTestsDisabled()
  })

  test('update undo restores the resource and keeps the surviving tag', async ({ request }) => {
    let token: string | null = null
    const resourceIds: string[] = []
    const tagIds: string[] = []
    try {
      token = await getAuthToken(request, 'admin')
      const stamp = `${Date.now()}-upd`
      const doomedTag = await createTag(request, token, `QA RESO-011 doomed ${stamp}`)
      const keptTag = await createTag(request, token, `QA RESO-011 kept ${stamp}`)
      tagIds.push(doomedTag, keptTag)
      const originalName = `QA RESO-011 resource ${stamp}`
      const createRes = await apiRequest(request, 'POST', RESOURCES, {
        token,
        data: { name: originalName, tags: [doomedTag, keptTag] },
      })
      expect(createRes.status(), 'resource create').toBe(201)
      const resourceId = ((await readJsonSafe(createRes)) as { id: string }).id
      resourceIds.push(resourceId)

      const updateRes = await apiRequest(request, 'PUT', RESOURCES, {
        token,
        data: { id: resourceId, name: `${originalName} renamed`, tags: [] },
      })
      expect(updateRes.status(), 'resource update').toBe(200)
      const updateOp = expectOperation(updateRes, 'resource update')

      await deleteTag(request, token, doomedTag)
      tagIds.splice(tagIds.indexOf(doomedTag), 1)

      await undoOk(request, token, updateOp.undoToken, 'resource update after tag delete')

      const restored = await readResource(request, token, resourceId)
      expect(restored, 'resource readable after undo').not.toBeNull()
      expect(restored!.name, 'undo restored the original name').toBe(originalName)
      expect(tagIdsOf(restored!), 'undo restored only the surviving tag').toEqual([keptTag])
    } finally {
      await cleanup(request, token, resourceIds, tagIds)
    }
  })

  test('delete undo restores the resource when its only tag was deleted', async ({ request }) => {
    let token: string | null = null
    const resourceIds: string[] = []
    const tagIds: string[] = []
    try {
      token = await getAuthToken(request, 'admin')
      const stamp = `${Date.now()}-del`
      const doomedTag = await createTag(request, token, `QA RESO-011 doomed ${stamp}`)
      tagIds.push(doomedTag)
      const name = `QA RESO-011 resource ${stamp}`
      const createRes = await apiRequest(request, 'POST', RESOURCES, { token, data: { name, tags: [doomedTag] } })
      expect(createRes.status(), 'resource create').toBe(201)
      const resourceId = ((await readJsonSafe(createRes)) as { id: string }).id
      resourceIds.push(resourceId)

      const deleteRes = await apiRequest(request, 'DELETE', `${RESOURCES}?id=${encodeURIComponent(resourceId)}`, { token })
      expect(deleteRes.ok(), `resource delete status ${deleteRes.status()}`).toBeTruthy()
      const deleteOp = expectOperation(deleteRes, 'resource delete')
      expect(await readResource(request, token, resourceId), 'resource hidden after delete').toBeNull()

      await deleteTag(request, token, doomedTag)
      tagIds.splice(tagIds.indexOf(doomedTag), 1)

      await undoOk(request, token, deleteOp.undoToken, 'resource delete after tag delete')

      const restored = await readResource(request, token, resourceId)
      expect(restored, 'undo brought the resource back').not.toBeNull()
      expect(restored!.name, 'restored resource keeps its name').toBe(name)
      expect(tagIdsOf(restored!), 'restored resource carries no deleted tag').toEqual([])
    } finally {
      await cleanup(request, token, resourceIds, tagIds)
    }
  })

  test('create redo restores the resource and keeps the surviving tag', async ({ request }) => {
    let token: string | null = null
    const resourceIds: string[] = []
    const tagIds: string[] = []
    try {
      token = await getAuthToken(request, 'admin')
      const stamp = `${Date.now()}-redo`
      const doomedTag = await createTag(request, token, `QA RESO-011 doomed ${stamp}`)
      const keptTag = await createTag(request, token, `QA RESO-011 kept ${stamp}`)
      tagIds.push(doomedTag, keptTag)
      const name = `QA RESO-011 resource ${stamp}`
      const createRes = await apiRequest(request, 'POST', RESOURCES, { token, data: { name, tags: [doomedTag, keptTag] } })
      expect(createRes.status(), 'resource create').toBe(201)
      const resourceId = ((await readJsonSafe(createRes)) as { id: string }).id
      resourceIds.push(resourceId)
      const createOp = expectOperation(createRes, 'resource create')

      await undoOk(request, token, createOp.undoToken, 'resource create')
      expect(await readResource(request, token, resourceId), 'resource hidden after create undo').toBeNull()

      await deleteTag(request, token, doomedTag)
      tagIds.splice(tagIds.indexOf(doomedTag), 1)

      await redoOk(request, token, createOp.logId, 'resource create after tag delete')

      const restored = await readResource(request, token, resourceId)
      expect(restored, 'redo brought the resource back').not.toBeNull()
      expect(restored!.name, 'redone resource keeps its name').toBe(name)
      expect(tagIdsOf(restored!), 'redo restored only the surviving tag').toEqual([keptTag])
    } finally {
      await cleanup(request, token, resourceIds, tagIds)
    }
  })

  test('a live update naming a deleted tag is still rejected', async ({ request }) => {
    let token: string | null = null
    const resourceIds: string[] = []
    const tagIds: string[] = []
    try {
      token = await getAuthToken(request, 'admin')
      const stamp = `${Date.now()}-live`
      const doomedTag = await createTag(request, token, `QA RESO-011 doomed ${stamp}`)
      tagIds.push(doomedTag)
      const createRes = await apiRequest(request, 'POST', RESOURCES, { token, data: { name: `QA RESO-011 resource ${stamp}` } })
      expect(createRes.status(), 'resource create').toBe(201)
      const resourceId = ((await readJsonSafe(createRes)) as { id: string }).id
      resourceIds.push(resourceId)
      await deleteTag(request, token, doomedTag)
      tagIds.splice(tagIds.indexOf(doomedTag), 1)

      const updateRes = await apiRequest(request, 'PUT', RESOURCES, { token, data: { id: resourceId, tags: [doomedTag] } })
      expect(updateRes.status(), 'live update with a deleted tag').toBe(400)
      const restored = await readResource(request, token, resourceId)
      expect(restored, 'resource readable after the rejected update').not.toBeNull()
      expect(tagIdsOf(restored!), 'rejected update assigned nothing').toEqual([])
    } finally {
      await cleanup(request, token, resourceIds, tagIds)
    }
  })
})
