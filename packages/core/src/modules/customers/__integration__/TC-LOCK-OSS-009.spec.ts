import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createPersonFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'
import {
  OPTIMISTIC_LOCK_HEADER_NAME,
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_CONFLICT_ERROR,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * TC-LOCK-OSS-009: optimistic locking on customer TASKS through the legacy
 * `/api/customers/todos` route (the surface QA exercises from the People/Deal
 * Tasks tab modal).
 *
 * Spec: .ai/specs/2026-05-25-oss-optimistic-locking.md
 *
 * Closes the round-4 QA gaps for #2055:
 *   - A stale task edit (concurrent edit from another tab) is refused with the
 *     unified 409 conflict body instead of silently overwriting.
 *   - A stale task edit AFTER the task was deleted elsewhere returns the same
 *     structured 409 (record-gone → conflict) instead of a bare
 *     "Interaction not found" 404.
 *
 * The todos route bridges to the `customers.interactions.update` command, which
 * now calls `enforceCommandOptimisticLock` / `enforceRecordGoneIsConflict`. The
 * client (usePersonTasks / useInteractions) sends the `updated_at` header, which
 * the route propagates into the command context. The GET list now exposes the
 * task's `todoUpdatedAt` so the client can build that header.
 */

const BASE_URL = process.env.BASE_URL?.trim() || null
function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

async function createTask(
  request: APIRequestContext,
  token: string,
  personId: string,
  title: string,
): Promise<{ todoId: string; linkId: string }> {
  const res = await apiRequest(request, 'POST', '/api/customers/todos', {
    token,
    data: { entityId: personId, title, todoCustom: { priority: 3 } },
  })
  expect(res.status(), 'POST /api/customers/todos should create the task (201)').toBe(201)
  const body = await readJsonSafe<Record<string, unknown>>(res)
  const todoId = typeof body?.todoId === 'string' ? body.todoId : null
  const linkId = typeof body?.linkId === 'string' ? body.linkId : null
  expect(todoId, 'create response should include todoId').toBeTruthy()
  expect(linkId, 'create response should include linkId').toBeTruthy()
  return { todoId: todoId as string, linkId: linkId as string }
}

async function fetchTaskUpdatedAt(
  request: APIRequestContext,
  token: string,
  personId: string,
  todoId: string,
): Promise<string> {
  const res = await apiRequest(
    request,
    'GET',
    `/api/customers/todos?entityId=${encodeURIComponent(personId)}&page=1&pageSize=100`,
    { token },
  )
  expect(res.ok(), 'GET /api/customers/todos should return 200').toBeTruthy()
  const body = await readJsonSafe<Record<string, unknown>>(res)
  const items = Array.isArray(body?.items) ? (body!.items as Array<Record<string, unknown>>) : []
  const row = items.find((item) => item.todoId === todoId)
  expect(row, 'todos list should include the created task').toBeTruthy()
  const raw = row?.todoUpdatedAt
  expect(typeof raw, 'todos list should expose todoUpdatedAt as a string (#2055)').toBe('string')
  const ms = Date.parse(raw as string)
  expect(Number.isFinite(ms), `todoUpdatedAt should parse as a date, got: ${raw as string}`).toBe(true)
  return new Date(ms).toISOString()
}

async function putTask(
  request: APIRequestContext,
  token: string,
  ids: { todoId: string; linkId: string },
  title: string,
  headerValue?: string,
) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  if (headerValue !== undefined) headers[OPTIMISTIC_LOCK_HEADER_NAME] = headerValue
  return request.fetch(resolveUrl('/api/customers/todos'), {
    method: 'PUT',
    headers,
    data: { id: ids.todoId, linkId: ids.linkId, title },
  })
}

test.describe('TC-LOCK-OSS-009: customer task (todos) optimistic-lock guard', () => {
  test('concurrent edit — stale task PUT returns 409 instead of silently overwriting', async ({ request }) => {
    let token: string | null = null
    let personId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const stamp = Date.now()
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `LOCK009C${stamp}`,
        displayName: `QA TC-LOCK-OSS-009 concurrent ${stamp}`,
      })
      const ids = await createTask(request, token, personId, `QA LOCK-009 task ${stamp}`)

      const t0 = await fetchTaskUpdatedAt(request, token, personId, ids.todoId)

      // Session A wins with the fresh token.
      const sessionA = await putTask(request, token, ids, `QA LOCK-009 A ${Date.now()}`, t0)
      expect(sessionA.status(), 'session A (fresh token) PUT should succeed').toBeLessThan(300)

      const t1 = await fetchTaskUpdatedAt(request, token, personId, ids.todoId)
      expect(t1, 'task updated_at should advance after session A').not.toBe(t0)

      // Session B (stale) is refused with the structured 409.
      const sessionB = await putTask(request, token, ids, `QA LOCK-009 B ${Date.now()}`, t0)
      expect(sessionB.status(), 'stale session B PUT should be refused with 409').toBe(409)
      const body = await readJsonSafe<Record<string, unknown>>(sessionB)
      expect(body).toMatchObject({
        error: OPTIMISTIC_LOCK_CONFLICT_ERROR,
        code: OPTIMISTIC_LOCK_CONFLICT_CODE,
      })

      // A header-less PUT still passes through (strictly additive).
      const noHeader = await putTask(request, token, ids, `QA LOCK-009 nohdr ${Date.now()}`)
      expect(noHeader.status(), 'PUT without the header should still succeed (additive)').toBeLessThan(300)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('stale edit after delete returns 409 conflict, not a bare 404', async ({ request }) => {
    let token: string | null = null
    let personId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const stamp = Date.now()
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `LOCK009G${stamp}`,
        displayName: `QA TC-LOCK-OSS-009 gone ${stamp}`,
      })
      const ids = await createTask(request, token, personId, `QA LOCK-009 gone task ${stamp}`)
      const t0 = await fetchTaskUpdatedAt(request, token, personId, ids.todoId)

      // Delete the task in "tab A".
      const del = await apiRequest(request, 'DELETE', '/api/customers/todos', {
        token,
        data: { id: ids.todoId },
      })
      expect(del.ok(), 'delete should succeed').toBeTruthy()

      // "Tab B" saves a stale edit against the now-deleted task. With the lock
      // header present this surfaces the unified 409 conflict instead of 404.
      const staleSave = await putTask(request, token, ids, `QA LOCK-009 stale ${Date.now()}`, t0)
      expect(
        staleSave.status(),
        'stale edit after delete should return 409 (record-gone → conflict), not 404',
      ).toBe(409)
      const body = await readJsonSafe<Record<string, unknown>>(staleSave)
      expect(body).toMatchObject({
        error: OPTIMISTIC_LOCK_CONFLICT_ERROR,
        code: OPTIMISTIC_LOCK_CONFLICT_CODE,
      })
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})
