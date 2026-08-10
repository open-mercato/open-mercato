import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { createQueue } from '@open-mercato/queue'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'

export const integrationMeta = {
  dependsOnModules: ['example', 'progress', 'events', 'scheduler'],
}

const TODOS_API = '/api/example/todos'
const BULK_API = '/api/example/todos/bulk-complete'
const PROGRESS_JOB_API = '/api/progress/jobs'
const BULK_QUEUE = 'example-todos-bulk-complete'
const DISPATCH_QUEUE = 'example-todos-bulk-dispatch'
const APP_ROOT = path.resolve(process.env.OM_TEST_APP_ROOT?.trim() || path.resolve(process.cwd(), 'apps/mercato'))
const APP_QUEUE_BASE_DIR = process.env.QUEUE_BASE_DIR?.trim() || path.resolve(APP_ROOT, '.mercato/queue')

type BulkResponse = { ok?: boolean; progressJobId?: string | null; message?: string }
type ProgressJob = {
  id: string
  status: string
  processedCount: number | null
  totalCount: number | null
  cancellable: boolean
  resultSummary: { affectedCount?: number; failedCount?: number; failedItems?: unknown[] } | null
}
type OperationRow = {
  id: string
  status: string
  progress_job_id: string
  next_item_index: number
  succeeded_count: number
  failed_count: number
  published_at: Date | null
  publish_attempts: number
  lease_owner: string | null
  lease_expires_at: Date | null
}

async function createTodo(request: APIRequestContext, token: string, title: string): Promise<string> {
  const created = await apiRequest(request, 'POST', TODOS_API, {
    token,
    data: { title, cf_priority: 1, cf_severity: 'low' },
  })
  expect(created.ok(), `create todo failed: ${created.status()} ${await created.text()}`).toBeTruthy()
  const id = (await created.json() as { id?: string }).id ?? null
  expect(id, 'the create response must name the new todo').toBeTruthy()
  return id!
}

async function readTodoDone(request: APIRequestContext, token: string, id: string): Promise<boolean | null> {
  const response = await apiRequest(request, 'GET', `${TODOS_API}?ids=${id}&page=1&pageSize=1`, { token })
  if (!response.ok()) return null
  const payload = await response.json() as { items?: Array<{ id?: string; is_done?: boolean; isDone?: boolean }> }
  const row = (payload.items ?? []).find((item) => item.id === id)
  if (!row) return null
  return row.is_done ?? row.isDone ?? null
}

async function readProgressJob(
  request: APIRequestContext,
  token: string,
  jobId: string,
): Promise<ProgressJob | null> {
  const response = await apiRequest(request, 'GET', `${PROGRESS_JOB_API}/${jobId}`, { token })
  if (!response.ok()) return null
  return await response.json() as ProgressJob
}

async function loadOperation(idempotencyKey: string): Promise<OperationRow | null> {
  return withClient(async (client) => {
    const result = await client.query<OperationRow>(
      `SELECT id, status, progress_job_id, next_item_index, succeeded_count, failed_count,
              published_at, publish_attempts, lease_owner, lease_expires_at
         FROM example_todo_bulk_operations
        WHERE idempotency_key = $1`,
      [idempotencyKey],
    )
    return result.rows[0] ?? null
  })
}

async function deleteOperation(idempotencyKey: string): Promise<void> {
  await withClient(async (client) => {
    await client.query('DELETE FROM example_todo_bulk_operations WHERE idempotency_key = $1', [idempotencyKey])
  })
}

/**
 * Fires one outbox-recovery tick.
 *
 * The dispatcher is scheduler-driven, and the schedule's own interval is far longer than a test
 * run, so the tick is enqueued here with the same `{ tenantId, organizationId }` payload
 * `setup.ts` registers. That is the real worker recovering from the real durable rows — only the
 * clock is replaced.
 */
async function runDispatcherTick(scope: { tenantId: string; organizationId: string; userId: string }): Promise<void> {
  const queue = createQueue(DISPATCH_QUEUE, 'local', { baseDir: APP_QUEUE_BASE_DIR, concurrency: 1 })
  try {
    await queue.enqueue({
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      userId: scope.userId,
    })
  } finally {
    await queue.close()
  }
  await drainIntegrationQueue(DISPATCH_QUEUE)
}

/**
 * Runs the execution queue until the operation reaches a terminal state.
 *
 * The ephemeral stack runs its own workers, so this drain races them deliberately: whichever
 * process wins, the compare-and-swap lease means only one executes, and the loser's message is
 * the duplicate-physical-delivery case the spec asks for rather than a flake.
 */
async function settleOperation(idempotencyKey: string, attempts = 12): Promise<OperationRow | null> {
  let row: OperationRow | null = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await drainIntegrationQueue(BULK_QUEUE)
    row = await loadOperation(idempotencyKey)
    if (row && ['completed', 'failed', 'cancelled'].includes(row.status)) return row
    await new Promise((resolve) => { setTimeout(resolve, 500) })
  }
  return row
}

/**
 * Milestone B coverage for the DataTable bulk action, its durable operation, the queue worker
 * and the top progress bar — the four mechanisms the canonical module wires into one path.
 *
 * The surface under test is deliberately not "a bulk endpoint". It is the contract the
 * DataTable's `runBulkAction` depends on: a 202 carrying a `progressJobId`, a durable outbox row
 * that survives a crash between the commit and the enqueue, a leased and checkpointed worker
 * that can be interrupted and resumed without repeating a mutation, and a progress job that
 * reaches exactly one terminal state carrying a bounded result summary.
 *
 * Crash and interruption are simulated by writing the durable row into the state a crash would
 * have left behind, then letting the real dispatcher and the real worker recover it. That is the
 * only honest way to reach those branches from outside the process — killing a worker mid-flight
 * would leave the assertion depending on where the kill landed — and it exercises the same rows
 * the recovery code reads rather than a fake store, which the unit tests already cover.
 */
test.describe('TC-EXAMPLE-003: the todo bulk-complete operation is durable, scoped, idempotent and cancellable', () => {
  test('runs from the DataTable selection, drives the top progress bar and completes every selected todo', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const todoIds: string[] = []

    try {
      todoIds.push(await createTodo(request, token, `TC-EXAMPLE-003 A ${suffix}`))
      todoIds.push(await createTodo(request, token, `TC-EXAMPLE-003 B ${suffix}`))

      await login(page, 'admin')
      await page.goto('/backend/todos', { waitUntil: 'domcontentloaded' })

      // Scoped to `main`: the AppShell sidebar also renders a placeholder-"Search" input for
      // navigation, and an unscoped locator picks that one whenever the sidebar is expanded.
      const searchInput = page.locator('main input[placeholder="Search"]').first()
      await expect(searchInput).toBeVisible({ timeout: 60_000 })

      // Re-typed on every attempt, deliberately. `DataTable` restores its persisted view state
      // asynchronously and calls `onSearchChange(normalized.searchValue ?? '')` when it lands, so
      // a search typed before the restore is wiped by a view that carries none. On a warm page the
      // restore has already happened and one fill is enough; on a cold one it has not, which is
      // exactly the difference between this test passing first try and only on retry.
      await expect
        .poll(async () => {
          await searchInput.fill(suffix)
          await page.waitForTimeout(1500)
          return page.locator('tbody tr').count()
        }, { timeout: 60_000, intervals: [1000, 2000, 3000] })
        .toBe(2)

      // The checkbox column exists only because an injected bulk action is registered — its
      // presence is the registration assertion, not a UI detail.
      const selectAll = page.locator('thead').getByRole('checkbox')
      await expect(selectAll).toBeVisible()
      await selectAll.check()
      await expect(page.locator('tbody').getByRole('checkbox', { checked: true })).toHaveCount(2)

      const markDone = page.getByRole('button', { name: /Mark selected todos done/i })
      await expect(markDone).toBeVisible()

      const [bulkRequest, bulkResponse] = await Promise.all([
        page.waitForRequest((candidate) =>
          candidate.url().includes(BULK_API) && candidate.method() === 'POST'),
        page.waitForResponse((response) =>
          response.url().includes(BULK_API) && response.request().method() === 'POST'),
        markDone.click(),
      ])
      // What the action sent IS the selection contract: exactly the filtered rows, no more.
      const sentIds = (bulkRequest.postDataJSON() as { ids?: string[] }).ids ?? []
      expect([...sentIds].sort()).toEqual([...todoIds].sort())
      expect(bulkResponse.status(), 'the bulk route answers 202 the moment the operation is durable').toBe(202)
      const body = await bulkResponse.json() as BulkResponse
      expect(body.ok).toBe(true)
      expect(body.progressJobId, 'the DataTable contract requires a progress job id').toBeTruthy()
      const progressJobId = body.progressJobId!

      // Start feedback and the top progress bar are both driven by that id.
      await expect(page.getByText(/Bulk completion started/i).first()).toBeVisible({ timeout: 15_000 })

      const settled = await settleOperation(
        (await withClient(async (client) => {
          const result = await client.query<{ idempotency_key: string }>(
            'SELECT idempotency_key FROM example_todo_bulk_operations WHERE progress_job_id = $1',
            [progressJobId],
          )
          return result.rows[0]?.idempotency_key ?? ''
        })),
      )
      expect(settled?.status, 'the operation must reach a terminal state').toBe('completed')
      expect(settled?.succeeded_count).toBe(2)
      expect(settled?.failed_count).toBe(0)
      // The lease is cleared on finish, which is what makes a duplicate physical message a no-op.
      expect(settled?.lease_owner).toBeNull()

      const job = await readProgressJob(request, token, progressJobId)
      expect(job?.status).toBe('completed')
      expect(job?.processedCount).toBe(2)
      expect(job?.totalCount).toBe(2)
      expect(job?.resultSummary?.affectedCount).toBe(2)
      expect(job?.resultSummary?.failedCount).toBe(0)

      for (const id of todoIds) {
        expect(await readTodoDone(request, token, id), `${id} must be done`).toBe(true)
      }
    } finally {
      for (const id of todoIds) {
        await deleteEntityIfExists(request, token, TODOS_API, id)
      }
    }
  })

  test('races two identical requests onto one operation and one progress job', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const idempotencyKey = randomUUID()
    const todoIds: string[] = []

    try {
      todoIds.push(await createTodo(request, token, `TC-EXAMPLE-003 idem ${suffix}`))

      // Issued concurrently on purpose: the uniqueness is enforced by the database rather than
      // by a read-then-write check, so the interleaved case is the one worth proving.
      const [first, second] = await Promise.all([
        apiRequest(request, 'POST', BULK_API, { token, data: { ids: todoIds, idempotencyKey } }),
        apiRequest(request, 'POST', BULK_API, { token, data: { ids: todoIds, idempotencyKey } }),
      ])
      expect(first.status()).toBe(202)
      expect(second.status()).toBe(202)
      const firstBody = await first.json() as BulkResponse
      const secondBody = await second.json() as BulkResponse
      expect(firstBody.progressJobId).toBeTruthy()
      expect(secondBody.progressJobId).toBe(firstBody.progressJobId)

      const rowCount = await withClient(async (client) => {
        const result = await client.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM example_todo_bulk_operations WHERE idempotency_key = $1',
          [idempotencyKey],
        )
        return Number(result.rows[0]?.count ?? '-1')
      })
      expect(rowCount, 'two identical requests must converge on one durable operation').toBe(1)

      // The loser cancels the progress job it optimistically created, so no phantom entry is
      // left in the top bar. Exactly one job carries this operation's id.
      const jobCount = await withClient(async (client) => {
        const result = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM progress_jobs
            WHERE meta->>'idempotencyKey' = $1 AND status <> 'cancelled'`,
          [idempotencyKey],
        )
        return Number(result.rows[0]?.count ?? '-1')
      })
      expect(jobCount, 'the losing request must not leave a live phantom progress job').toBe(1)

      const settled = await settleOperation(idempotencyKey)
      expect(settled?.status).toBe('completed')
      expect(settled?.succeeded_count, 'one logical execution, however many messages arrived').toBe(1)
    } finally {
      await deleteOperation(idempotencyKey)
      for (const id of todoIds) {
        await deleteEntityIfExists(request, token, TODOS_API, id)
      }
    }
  })

  test('recovers an operation that crashed before publication, from the durable row alone', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const idempotencyKey = randomUUID()
    const todoIds: string[] = []

    try {
      todoIds.push(await createTodo(request, token, `TC-EXAMPLE-003 outbox ${suffix}`))

      const accepted = await apiRequest(request, 'POST', BULK_API, {
        token,
        data: { ids: todoIds, idempotencyKey },
      })
      expect(accepted.status()).toBe(202)

      // The crash: the durable row committed, the enqueue never happened. Written directly
      // because a real crash cannot be scheduled, and this is the exact state it leaves.
      await withClient(async (client) => {
        await client.query(
          `UPDATE example_todo_bulk_operations
              SET published_at = NULL, publish_attempts = 0, status = 'pending',
                  lease_owner = NULL, lease_expires_at = NULL
            WHERE idempotency_key = $1`,
          [idempotencyKey],
        )
      })
      const crashed = await loadOperation(idempotencyKey)
      expect(crashed?.published_at, 'the crash state must really be unpublished').toBeNull()

      // Drain the execution queue first: whatever the original request enqueued is consumed
      // here, so a pass cannot come from the pre-crash message still sitting in the queue.
      await drainIntegrationQueue(BULK_QUEUE)
      await withClient(async (client) => {
        await client.query(
          `UPDATE example_todo_bulk_operations
              SET published_at = NULL, publish_attempts = 0, status = 'pending',
                  next_item_index = 0, succeeded_count = 0,
                  lease_owner = NULL, lease_expires_at = NULL
            WHERE idempotency_key = $1`,
          [idempotencyKey],
        )
        await client.query('UPDATE todos SET is_done = false WHERE id = ANY($1::uuid[])', [todoIds])
      })

      await runDispatcherTick(getTokenScope(token))
      const republished = await settleOperation(idempotencyKey)
      expect(republished?.status, 'the dispatcher must recover the unpublished row').toBe('completed')
      expect(republished?.published_at, 'recovery records the publication it just made').not.toBeNull()
      expect(await readTodoDone(request, token, todoIds[0])).toBe(true)
    } finally {
      await deleteOperation(idempotencyKey)
      for (const id of todoIds) {
        await deleteEntityIfExists(request, token, TODOS_API, id)
      }
    }
  })

  test('resumes from its checkpoint after a mid-run crash without repeating the finished item', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const idempotencyKey = randomUUID()
    const todoIds: string[] = []

    try {
      todoIds.push(await createTodo(request, token, `TC-EXAMPLE-003 resume A ${suffix}`))
      todoIds.push(await createTodo(request, token, `TC-EXAMPLE-003 resume B ${suffix}`))

      const accepted = await apiRequest(request, 'POST', BULK_API, {
        token,
        data: { ids: todoIds, idempotencyKey },
      })
      expect(accepted.status()).toBe(202)
      const row = await loadOperation(idempotencyKey)
      expect(row?.status).toBe('pending')
      const orderedIds = await withClient(async (client) => {
        const result = await client.query<{ todo_ids: string[] }>(
          'SELECT todo_ids FROM example_todo_bulk_operations WHERE idempotency_key = $1',
          [idempotencyKey],
        )
        return result.rows[0]?.todo_ids ?? []
      })
      expect(orderedIds).toHaveLength(2)

      // The crash: item 0 landed and was checkpointed, then the worker died holding an expired
      // lease. The first todo is marked done to match the checkpoint the crash left behind, so
      // the row and the data agree — a resume that re-ran item 0 would be invisible otherwise.
      await drainIntegrationQueue(BULK_QUEUE)
      await withClient(async (client) => {
        await client.query('UPDATE todos SET is_done = false WHERE id = ANY($1::uuid[])', [todoIds])
        await client.query('UPDATE todos SET is_done = true WHERE id = $1', [orderedIds[0]])
        await client.query(
          `UPDATE example_todo_bulk_operations
              SET status = 'running', next_item_index = 1, succeeded_count = 1, failed_count = 0,
                  published_at = now(), lease_owner = 'crashed-worker',
                  lease_expires_at = now() - interval '10 minutes'
            WHERE idempotency_key = $1`,
          [idempotencyKey],
        )
      })

      // The dispatcher's second recovery branch: published, non-terminal, lease expired.
      await runDispatcherTick(getTokenScope(token))
      const resumed = await settleOperation(idempotencyKey)
      expect(resumed?.status).toBe('completed')
      expect(
        resumed?.succeeded_count,
        'the resumed run must count the checkpointed item once, not twice',
      ).toBe(2)
      expect(resumed?.next_item_index).toBe(2)
      expect(await readTodoDone(request, token, orderedIds[1])).toBe(true)
    } finally {
      await deleteOperation(idempotencyKey)
      for (const id of todoIds) {
        await deleteEntityIfExists(request, token, TODOS_API, id)
      }
    }
  })

  test('completes with a bounded failure summary when one selected todo disappears mid-run', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const idempotencyKey = randomUUID()
    const todoIds: string[] = []

    try {
      todoIds.push(await createTodo(request, token, `TC-EXAMPLE-003 mixed A ${suffix}`))
      todoIds.push(await createTodo(request, token, `TC-EXAMPLE-003 mixed B ${suffix}`))

      const accepted = await apiRequest(request, 'POST', BULK_API, {
        token,
        data: { ids: todoIds, idempotencyKey },
      })
      expect(accepted.status()).toBe(202)
      const progressJobId = (await accepted.json() as BulkResponse).progressJobId!

      const orderedIds = await withClient(async (client) => {
        const result = await client.query<{ todo_ids: string[] }>(
          'SELECT todo_ids FROM example_todo_bulk_operations WHERE idempotency_key = $1',
          [idempotencyKey],
        )
        return result.rows[0]?.todo_ids ?? []
      })

      // Delete the second selected todo after the operation was accepted: the route validated
      // scope up front, so this is the genuine mid-run disappearance rather than a rejected
      // request. Mixed success/failure must still COMPLETE — only an all-failed run fails.
      await withClient(async (client) => {
        await client.query('UPDATE todos SET deleted_at = now() WHERE id = $1', [orderedIds[1]])
      })

      const settled = await settleOperation(idempotencyKey)
      expect(settled?.status, 'partial success completes; it does not fail').toBe('completed')
      expect(settled?.succeeded_count).toBe(1)
      expect(settled?.failed_count).toBe(1)

      const job = await readProgressJob(request, token, progressJobId)
      expect(job?.status).toBe('completed')
      expect(job?.resultSummary?.affectedCount).toBe(1)
      expect(job?.resultSummary?.failedCount).toBe(1)
      const failedItems = job?.resultSummary?.failedItems as Array<{ id?: string; code?: string }> | undefined
      expect(failedItems).toHaveLength(1)
      expect(failedItems?.[0]?.id).toBe(orderedIds[1])
      // A stable code, never the raw message of whatever threw — the summary reaches the browser.
      expect(failedItems?.[0]?.code).toBe('not_found')
    } finally {
      await deleteOperation(idempotencyKey)
      for (const id of todoIds) {
        await deleteEntityIfExists(request, token, TODOS_API, id)
      }
    }
  })

  test('cancels between items and leaves the untouched todos alone', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const idempotencyKey = randomUUID()
    const todoIds: string[] = []

    try {
      for (let index = 0; index < 3; index += 1) {
        todoIds.push(await createTodo(request, token, `TC-EXAMPLE-003 cancel ${index} ${suffix}`))
      }

      const accepted = await apiRequest(request, 'POST', BULK_API, {
        token,
        data: { ids: todoIds, idempotencyKey },
      })
      expect(accepted.status()).toBe(202)
      const progressJobId = (await accepted.json() as BulkResponse).progressJobId!

      // The stack's own workers consume the message as soon as the 202 lands, so a cancel
      // issued from here would always lose the race and hit `cancelJob`'s benign terminal-state
      // return. Both durable rows are therefore rewound to the state that existed one instant
      // after acceptance — operation pending and unpublished, progress job pending and never
      // started — and the cancellation is then requested through the real DELETE endpoint
      // against a genuinely live job. Only the clock is faked; every code path below is real.
      await settleOperation(idempotencyKey)
      await withClient(async (client) => {
        await client.query('UPDATE todos SET is_done = false WHERE id = ANY($1::uuid[])', [todoIds])
        await client.query(
          `UPDATE example_todo_bulk_operations
              SET status = 'pending', next_item_index = 0, succeeded_count = 0, failed_count = 0,
                  published_at = NULL, lease_owner = NULL, lease_expires_at = NULL
            WHERE idempotency_key = $1`,
          [idempotencyKey],
        )
        await client.query(
          `UPDATE progress_jobs
              SET status = 'pending', processed_count = 0, progress_percent = 0,
                  started_at = NULL, finished_at = NULL, cancel_requested_at = NULL,
                  result_summary = NULL
            WHERE id = $1`,
          [progressJobId],
        )
      })
      expect(
        (await readProgressJob(request, token, progressJobId))?.status,
        'the rewind must leave a genuinely cancellable job',
      ).toBe('pending')

      const cancelled = await apiRequest(request, 'DELETE', `${PROGRESS_JOB_API}/${progressJobId}`, { token })
      expect(cancelled.ok(), `cancel failed: ${cancelled.status()} ${await cancelled.text()}`).toBeTruthy()

      await runDispatcherTick(getTokenScope(token))
      const settled = await settleOperation(idempotencyKey)
      expect(settled?.status).toBe('cancelled')
      expect(settled?.succeeded_count).toBe(0)

      for (const id of todoIds) {
        expect(await readTodoDone(request, token, id), `${id} must be untouched by a cancelled run`).toBe(false)
      }

      const job = await readProgressJob(request, token, progressJobId)
      expect(job?.status).toBe('cancelled')
    } finally {
      await deleteOperation(idempotencyKey)
      for (const id of todoIds) {
        await deleteEntityIfExists(request, token, TODOS_API, id)
      }
    }
  })

  test('refuses an id from another organization before anything durable is written', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const idempotencyKey = randomUUID()
    const { tenantId } = getTokenScope(token)
    let organizationId: string | null = null
    let ownTodoId: string | null = null
    let foreignTodoId: string | null = null

    try {
      ownTodoId = await createTodo(request, token, `TC-EXAMPLE-003 scope ${suffix}`)
      organizationId = await createOrganizationFixture(request, token, {
        name: `TC-EXAMPLE-003 org ${suffix}`,
        tenantId,
      })
      expect(organizationId).toBeTruthy()

      // A real Todo in a real sibling organization of the same tenant — the case that matters,
      // because a tenant-only scope check would let it through while an organization-scoped one
      // refuses it. A random UUID would pass either way and prove nothing.
      const foreignCreated = await apiRequestWithSelectedOrg(request, 'POST', TODOS_API, {
        token,
        selectedOrgId: organizationId,
        data: { title: `TC-EXAMPLE-003 foreign ${suffix}`, cf_priority: 1, cf_severity: 'low' },
      })
      expect(foreignCreated.ok(), `create foreign todo failed: ${foreignCreated.status()}`).toBeTruthy()
      foreignTodoId = (await foreignCreated.json() as { id?: string }).id ?? null
      expect(foreignTodoId).toBeTruthy()

      const refused = await apiRequest(request, 'POST', BULK_API, {
        token,
        data: { ids: [ownTodoId, foreignTodoId], idempotencyKey },
      })
      expect(refused.status()).toBe(404)
      expect((await refused.json() as BulkResponse).progressJobId).toBeNull()

      const row = await loadOperation(idempotencyKey)
      expect(row, 'a refused selection must leave no durable operation behind').toBeNull()
      expect(
        await readTodoDone(request, token, ownTodoId),
        'the in-scope todo in a refused selection stays untouched',
      ).toBe(false)
      const foreignDone = await withClient(async (client) => {
        const result = await client.query<{ is_done: boolean }>(
          'SELECT is_done FROM todos WHERE id = $1',
          [foreignTodoId],
        )
        return result.rows[0]?.is_done ?? null
      })
      expect(foreignDone, 'the other organization\'s todo is never touched').toBe(false)
    } finally {
      await deleteOperation(idempotencyKey)
      await deleteEntityIfExists(request, token, TODOS_API, ownTodoId)
      if (foreignTodoId && organizationId) {
        await apiRequestWithSelectedOrg(request, 'DELETE', TODOS_API, {
          token,
          selectedOrgId: organizationId,
          data: { id: foreignTodoId },
        }).catch(() => undefined)
      }
      await deleteOrganizationIfExists(request, token, organizationId)
    }
  })
})
