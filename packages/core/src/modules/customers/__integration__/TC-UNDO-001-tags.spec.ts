import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createCompanyFixture, createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  expectOperation,
  undoOk,
  redoOk,
  skipIfUndoTestsDisabled,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-001 customers.tags assignment membership (#2572).
 *
 * Tag assign/unassign are membership commands. Assigning a tag then undoing must remove the
 * membership (1→0), redo re-applies it (0→1), and undoing an unassign must restore the prior
 * membership. Membership is read back through the person detail `tags` array. Self-contained:
 * the tag and parent person are created via API and removed in teardown.
 */

const TAGS = '/api/customers/tags'
const ASSIGN = '/api/customers/tags/assign'
const UNASSIGN = '/api/customers/tags/unassign'

async function isTagAssigned(
  request: APIRequestContext,
  token: string,
  personId: string,
  tagId: string,
  collection: 'people' | 'companies' = 'people',
): Promise<boolean> {
  const res = await apiRequest(request, 'GET', `/api/customers/${collection}/${encodeURIComponent(personId)}`, { token })
  expect(res.status()).toBe(200)
  const body = (await readJsonSafe(res)) as { tags?: Array<{ id: string }> } | null
  return Boolean(body?.tags?.some((tag) => tag.id === tagId))
}

test.describe('TC-UNDO-001 customers.tags assign/unassign undo/redo', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('assign → undo removes membership → redo restores; unassign → undo restores', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let personId: string | null = null
    let tagId: string | null = null
    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'Undo',
        lastName: `TagTarget ${stamp}`,
        displayName: `Undo TagTarget ${stamp}`,
      })
      const tagRes = await apiRequest(request, 'POST', TAGS, {
        token,
        data: { slug: `undo-tag-${stamp}`, label: `Undo Tag ${stamp}` },
      })
      expect(tagRes.status(), `tag create status ${tagRes.status()}`).toBe(201)
      tagId = expectOperation(tagRes, 'tags.create').resourceId
      expect(tagId, 'tag id present').toBeTruthy()

      // assign → membership 1
      const assignRes = await apiRequest(request, 'POST', ASSIGN, { token, data: { tagId, entityId: personId } })
      expect(assignRes.status(), `assign status ${assignRes.status()}`).toBe(201)
      const assignOp = expectOperation(assignRes, 'tags.assign')
      expect(await isTagAssigned(request, token, personId as string, tagId as string), 'assigned after assign (1)').toBe(true)

      // undo assign → membership 0
      await undoOk(request, token, assignOp.undoToken, 'undo tag assign')
      expect(await isTagAssigned(request, token, personId as string, tagId as string), 'membership removed on undo (1→0)').toBe(false)

      // redo assign → membership 1 (I6)
      await redoOk(request, token, assignOp.logId, 'redo tag assign')
      expect(await isTagAssigned(request, token, personId as string, tagId as string), 'membership re-applied on redo (0→1)').toBe(true)

      // unassign → membership 0
      const unassignRes = await apiRequest(request, 'POST', UNASSIGN, { token, data: { tagId, entityId: personId } })
      expect(unassignRes.ok(), `unassign status ${unassignRes.status()}`).toBeTruthy()
      const unassignOp = expectOperation(unassignRes, 'tags.unassign')
      expect(await isTagAssigned(request, token, personId as string, tagId as string), 'removed after unassign').toBe(false)

      // undo unassign → membership restored
      await undoOk(request, token, unassignOp.undoToken, 'undo tag unassign')
      expect(await isTagAssigned(request, token, personId as string, tagId as string), 'membership restored on undo unassign').toBe(true)
    } finally {
      if (tagId && personId) await apiRequest(request, 'POST', UNASSIGN, { token, data: { tagId, entityId: personId } }).catch(() => {})
      await deleteEntityIfExists(request, token, TAGS, tagId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('tag delete → undo restores people and companies → redo deletes memberships → undo skips deleted customers', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const customers: Array<{ id: string; collection: 'people' | 'companies' }> = []
    let tagId: string | null = null
    try {
      for (const index of [1, 2]) {
        customers.push({
          id: await createPersonFixture(request, token, {
            firstName: 'Undo',
            lastName: `TagDelete ${stamp}-${index}`,
            displayName: `Undo TagDelete ${stamp}-${index}`,
          }),
          collection: 'people',
        })
        customers.push({
          id: await createCompanyFixture(request, token, `Undo TagDelete Company ${stamp}-${index}`),
          collection: 'companies',
        })
      }
      const tagResponse = await apiRequest(request, 'POST', TAGS, {
        token,
        data: { slug: `undo-tag-delete-${stamp}`, label: `Undo TagDelete ${stamp}` },
      })
      expect(tagResponse.status()).toBe(201)
      tagId = expectOperation(tagResponse, 'tags.create').resourceId
      expect(tagId).toBeTruthy()
      const restoredTagId = tagId as string
      for (const customer of customers) {
        const assigned = await apiRequest(request, 'POST', ASSIGN, {
          token,
          data: { tagId, entityId: customer.id },
        })
        expect(assigned.status()).toBe(201)
        expect(await isTagAssigned(request, token, customer.id, restoredTagId, customer.collection)).toBe(true)
      }

      const deleted = await apiRequest(request, 'DELETE', `${TAGS}?id=${encodeURIComponent(restoredTagId)}`, { token })
      expect(deleted.ok()).toBeTruthy()
      const operation = expectOperation(deleted, 'tags.delete')
      for (const customer of customers) {
        expect(await isTagAssigned(request, token, customer.id, restoredTagId, customer.collection)).toBe(false)
      }

      await undoOk(request, token, operation.undoToken, 'undo tag delete')
      for (const customer of customers) {
        expect(await isTagAssigned(request, token, customer.id, restoredTagId, customer.collection)).toBe(true)
      }
      for (const collection of ['people', 'companies'] as const) {
        const filtered = await apiRequest(request, 'GET', `/api/customers/${collection}?tagIds=${encodeURIComponent(restoredTagId)}`, { token })
        expect(filtered.ok()).toBeTruthy()
        const body = await readJsonSafe<{ items?: Array<{ id: string }> }>(filtered)
        expect(body?.items?.map((item) => item.id).sort()).toEqual(
          customers.filter((customer) => customer.collection === collection).map((customer) => customer.id).sort(),
        )
      }

      const replay = await redoOk(request, token, operation.logId, 'redo tag delete')
      for (const customer of customers) {
        expect(await isTagAssigned(request, token, customer.id, restoredTagId, customer.collection)).toBe(false)
      }
      const removedCustomer = customers[0]
      const removed = await apiRequest(request, 'DELETE', `/api/customers/${removedCustomer.collection}?id=${encodeURIComponent(removedCustomer.id)}`, { token })
      expect(removed.ok()).toBeTruthy()
      expect(replay.undoToken).toBeTruthy()
      await undoOk(request, token, replay.undoToken as string, 'undo tag delete after customer deletion')
      for (const customer of customers.slice(1)) {
        expect(await isTagAssigned(request, token, customer.id, restoredTagId, customer.collection)).toBe(true)
      }
    } finally {
      await deleteEntityIfExists(request, token, TAGS, tagId)
      for (const customer of customers) {
        await deleteEntityIfExists(request, token, `/api/customers/${customer.collection}`, customer.id)
      }
    }
  })
})
