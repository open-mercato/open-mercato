import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['hr_management'],
}

/**
 * TC-HR-002: the department tree refuses to become a cycle.
 *
 * `parent_department_id` is a plain uuid column with no database-level guard, so the only thing
 * standing between an operator (or any API client) and a self-parented department is
 * `assertDepartmentWritable`. A stored cycle makes the tree unrenderable and every ancestor walk
 * non-terminating, which is why this is an integration test rather than a unit test: the rule needs
 * the real rows to walk.
 *
 * The same spec covers the two list filters the departments screen depends on, because a filter that
 * is accepted but not applied is indistinguishable from one that works — until someone uses it.
 */

const DEPARTMENTS = '/api/hr_management/departments'

type DepartmentItem = {
  id?: string
  name?: string
  parent_department_id?: string | null
  is_active?: boolean
}

let fixtureCounter = 0
function uniqueSuffix(): string {
  fixtureCounter += 1
  return `${Date.now()}-${fixtureCounter}`
}

async function createDepartment(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', DEPARTMENTS, { token, data })
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(response.ok(), `POST ${DEPARTMENTS} failed with ${response.status()}: ${JSON.stringify(body)}`).toBeTruthy()
  return body?.id as string
}

async function deleteDepartment(request: APIRequestContext, token: string, id: string): Promise<void> {
  try {
    await apiRequest(request, 'DELETE', `${DEPARTMENTS}?id=${encodeURIComponent(id)}`, { token })
  } catch {
    // Cleanup must not mask the assertion that failed first.
  }
}

async function listDepartments(
  request: APIRequestContext,
  token: string,
  query: string,
): Promise<{ status: number; items: DepartmentItem[] }> {
  const response = await apiRequest(request, 'GET', `${DEPARTMENTS}?${query}`, { token })
  const body = await readJsonSafe<{ items?: DepartmentItem[] }>(response)
  return { status: response.status(), items: body?.items ?? [] }
}

test.describe('TC-HR-002: department integrity', () => {
  test('refuses a cycle, refuses an unknown parent, and filters by name and status', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueSuffix()
    const createdIds: string[] = []

    try {
      const rootId = await createDepartment(request, token, { name: `TC HR 002 Root ${suffix}`, code: `TCHR002R-${suffix}` })
      createdIds.push(rootId)
      const childId = await createDepartment(request, token, {
        name: `TC HR 002 Child ${suffix}`,
        code: `TCHR002C-${suffix}`,
        parentDepartmentId: rootId,
      })
      createdIds.push(childId)
      const grandChildId = await createDepartment(request, token, {
        name: `TC HR 002 Grandchild ${suffix}`,
        code: `TCHR002G-${suffix}`,
        parentDepartmentId: childId,
      })
      createdIds.push(grandChildId)

      // Re-parenting the root under its own grandchild is the cycle the UI filters out and the API
      // must refuse.
      const cycleResponse = await apiRequest(request, 'PUT', DEPARTMENTS, {
        token,
        data: { id: rootId, parentDepartmentId: grandChildId },
      })
      const cycleBody = await readJsonSafe<{ error?: string }>(cycleResponse)
      expect(cycleResponse.status(), `expected a refusal, got ${cycleResponse.status()}`).toBe(409)
      expect(typeof cycleBody?.error).toBe('string')

      // Self-parenting is refused by the same walk.
      const selfResponse = await apiRequest(request, 'PUT', DEPARTMENTS, {
        token,
        data: { id: rootId, parentDepartmentId: rootId },
      })
      expect(selfResponse.status()).toBe(409)

      // A parent that does not exist is a different failure, and a different message.
      const unknownParent = '00000000-0000-4000-8000-0000000000ff'
      const orphanResponse = await apiRequest(request, 'POST', DEPARTMENTS, {
        token,
        data: { name: `TC HR 002 Orphan ${suffix}`, parentDepartmentId: unknownParent },
      })
      expect(orphanResponse.status()).toBe(400)

      // The tree is still readable after the refusals: nothing was half-written.
      const tree = await listDepartments(request, token, `name=${encodeURIComponent(`TC HR 002`)}&pageSize=50`)
      expect(tree.status).toBe(200)
      expect(tree.items.length).toBe(3)
      expect(tree.items.map((item) => item.parent_department_id)).toContain(rootId)
      // A name filter must match the name, not the whole table.
      expect(tree.items.every((item) => (item.name ?? '').includes('TC HR 002'))).toBe(true)

      const inactive = await listDepartments(request, token, `isActive=false&name=${encodeURIComponent('TC HR 002')}&pageSize=50`)
      expect(inactive.status).toBe(200)
      expect(inactive.items.length).toBe(0)
    } finally {
      for (const id of [...createdIds].reverse()) {
        await deleteDepartment(request, token, id)
      }
    }
  })
})
