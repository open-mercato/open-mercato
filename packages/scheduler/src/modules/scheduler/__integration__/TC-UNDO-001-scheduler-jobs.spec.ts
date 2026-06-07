import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { skipIfUndoTestsDisabled } from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-001: scheduler.jobs undo round-trip (regression for issue #2504).
 *
 * Before the fix, every scheduler.jobs undo handler read `logEntry.payload`
 * (always undefined — the command bus persists the undo snapshot under
 * `commandPayload`), so undo returned `{ ok: true }` while silently changing
 * nothing. This spec exercises the real HTTP path end-to-end:
 *   - CREATE -> undo  => job is soft-deleted (no longer listed)
 *   - UPDATE -> undo  => renamed field is restored to its prior value
 *   - DELETE -> undo  => soft-deleted job is re-materialized
 *
 * Endpoints covered:
 *   - POST   /api/scheduler/jobs                       (create)
 *   - GET    /api/scheduler/jobs?id=                   (read)
 *   - PUT    /api/scheduler/jobs                       (update)
 *   - DELETE /api/scheduler/jobs                       (delete, cleanup)
 *   - POST   /api/audit_logs/audit-logs/actions/undo   (undo)
 */

type ScheduleRow = {
  id: string
  name: string
  description: string | null
  scheduleValue: string
}

// The undo endpoint only honors the *latest* undoable log for a resource, and
// `latestUndoableForResource` orders by `created_at` alone. Audit `created_at` is
// millisecond-precision (`new Date()` at log time), so a create + a follow-up
// mutation issued within the same millisecond tie and the lookup may resolve to
// the wrong log. A short settle guarantees the operation under undo is strictly
// the most recent, keeping the round-trip deterministic.
async function settleAuditClock(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50))
}

function readUndoToken(res: APIResponse): string {
  const header = res.headers()['x-om-operation'] ?? ''
  const enc = header.startsWith('omop:') ? header.slice(5) : ''
  expect(enc, 'x-om-operation header should carry an omop: payload').not.toBe('')
  const payload = JSON.parse(decodeURIComponent(enc)) as { undoToken?: string }
  expect(typeof payload.undoToken, 'undoToken present in operation payload').toBe('string')
  return payload.undoToken as string
}

async function getById(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<ScheduleRow | undefined> {
  const res = await apiRequest(request, 'GET', `/api/scheduler/jobs?id=${encodeURIComponent(id)}`, { token })
  expect(res.status()).toBe(200)
  const body = (await res.json()) as { items?: ScheduleRow[] }
  return (body.items ?? [])[0]
}

async function createJob(request: APIRequestContext, token: string, name: string): Promise<{ id: string; res: APIResponse }> {
  const res = await apiRequest(request, 'POST', '/api/scheduler/jobs', {
    token,
    data: {
      name,
      description: 'TC-UNDO-001 probe',
      scopeType: 'tenant',
      scheduleType: 'cron',
      scheduleValue: '0 0 * * *',
      timezone: 'UTC',
      targetType: 'queue',
      targetQueue: 'default',
      isEnabled: true,
      sourceType: 'user',
    },
  })
  expect(res.status(), 'create returns 201').toBe(201)
  const id = ((await res.json()) as { id: string }).id
  expect(id, 'create returns an id').toBeTruthy()
  return { id, res }
}

async function undo(request: APIRequestContext, token: string, undoToken: string): Promise<void> {
  const res = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/undo', {
    token,
    data: { undoToken },
  })
  const raw = await res.text()
  expect(res.status(), `undo returns 200 (body: ${raw})`).toBe(200)
  const body = JSON.parse(raw) as { ok?: boolean }
  expect(body.ok, 'undo body is { ok: true }').toBe(true)
}

async function cleanup(request: APIRequestContext, token: string | null, id: string | null): Promise<void> {
  if (!token || !id) return
  try {
    await apiRequest(request, 'DELETE', '/api/scheduler/jobs', { token, data: { id } })
  } catch {
    /* ignore */
  }
}

test.describe('TC-UNDO-001: scheduler.jobs undo actually restores state (#2504)', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('UPDATE -> undo restores the prior name', async ({ request }) => {
    let token: string | null = null
    let id: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const originalName = `TC-UNDO-001 Update ${Date.now()}`
      ;({ id } = await createJob(request, token, originalName))
      await settleAuditClock()

      const updateRes = await apiRequest(request, 'PUT', '/api/scheduler/jobs', {
        token,
        data: { id, name: `${originalName} RENAMED` },
      })
      expect(updateRes.status(), 'update returns 200').toBe(200)
      expect((await getById(request, token, id))?.name).toBe(`${originalName} RENAMED`)

      await undo(request, token, readUndoToken(updateRes))

      const restored = await getById(request, token, id)
      expect(restored, 'job still exists after update-undo').toBeTruthy()
      expect(restored!.name, 'name restored to original by undo').toBe(originalName)
    } finally {
      await cleanup(request, token, id)
    }
  })

  test('DELETE -> undo re-lists the soft-deleted job', async ({ request }) => {
    let token: string | null = null
    let id: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const name = `TC-UNDO-001 Delete ${Date.now()}`
      ;({ id } = await createJob(request, token, name))
      await settleAuditClock()

      const deleteRes = await apiRequest(request, 'DELETE', '/api/scheduler/jobs', {
        token,
        data: { id },
      })
      expect(deleteRes.status(), 'delete returns 200').toBe(200)
      expect(await getById(request, token, id), 'job is gone after delete').toBeFalsy()

      await undo(request, token, readUndoToken(deleteRes))

      const restored = await getById(request, token, id)
      expect(restored, 'job re-materialized by delete-undo').toBeTruthy()
      expect(restored!.name).toBe(name)
    } finally {
      await cleanup(request, token, id)
    }
  })

  test('CREATE -> undo removes the created job', async ({ request }) => {
    let token: string | null = null
    let id: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const name = `TC-UNDO-001 Create ${Date.now()}`
      const created = await createJob(request, token, name)
      id = created.id

      expect(await getById(request, token, id), 'job exists after create').toBeTruthy()

      await undo(request, token, readUndoToken(created.res))

      expect(await getById(request, token, id), 'job removed by create-undo').toBeFalsy()
      id = null // already undone; nothing to clean up
    } finally {
      await cleanup(request, token, id)
    }
  })
})
