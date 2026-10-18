import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  expectOperation,
  redoByLogId,
  skipIfUndoTestsDisabled,
  undoByToken,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness'
import {
  SCHEDULER_JOBS_PATH,
  SCHEDULER_TEST_COMMAND,
  createScheduleJob,
  deleteScheduleJob,
  getScheduleJobById,
  uniqueScheduleName,
} from './helpers/scheduler'

/**
 * TC-SCHED-010: undo/redo cannot push a tenant past its active-schedule cap.
 *
 * Creating or enabling a schedule is refused once the tenant holds
 * OM_SCHEDULER_MAX_ACTIVE_SCHEDULES_PER_TENANT active schedules. Undoing an
 * update that disabled a schedule, undoing a delete of an enabled schedule and
 * redoing an enabled create all make a schedule active again, so they must be
 * refused the same way and leave the schedule untouched.
 *
 * The cap is discovered by creating enabled fixtures until the create endpoint
 * answers 422, so the spec does not depend on the configured limit or on the
 * schedules already present in the tenant.
 *
 * Endpoints covered:
 *   - POST   /api/scheduler/jobs
 *   - PUT    /api/scheduler/jobs
 *   - DELETE /api/scheduler/jobs
 *   - GET    /api/scheduler/jobs?id=
 *   - POST   /api/audit_logs/audit-logs/actions/undo
 *   - POST   /api/audit_logs/audit-logs/actions/redo
 *
 * UI covered: /backend/config/scheduled-jobs/:id/edit save, then Undo in the
 * last-operation banner shows the translated cap message.
 */

const MAX_FILLERS = 250

type ErrorBody = { error?: string }

async function settleAuditClock(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50))
}

function fixturePayload(name: string): Record<string, unknown> {
  return {
    name,
    description: 'TC-SCHED-010 fixture',
    scopeType: 'tenant',
    scheduleType: 'cron',
    scheduleValue: '0 0 1 1 *',
    timezone: 'UTC',
    targetType: 'command',
    targetCommand: SCHEDULER_TEST_COMMAND,
    isEnabled: true,
    sourceType: 'user',
  }
}

async function createFixture(request: APIRequestContext, token: string): Promise<{ id: string; response: APIResponse }> {
  const response = await apiRequest(request, 'POST', SCHEDULER_JOBS_PATH, {
    token,
    data: fixturePayload(uniqueScheduleName('TC-SCHED-010')),
  })
  expect(response.status(), 'fixture create returns 201').toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(typeof body?.id, 'fixture create returns an id').toBe('string')
  return { id: String(body?.id), response }
}

async function fillToCap(request: APIRequestContext, token: string, fillers: string[]): Promise<string> {
  for (let attempt = 0; attempt < MAX_FILLERS; attempt += 1) {
    const response = await apiRequest(request, 'POST', SCHEDULER_JOBS_PATH, {
      token,
      data: fixturePayload(uniqueScheduleName('TC-SCHED-010 filler')),
    })
    const body = await readJsonSafe<ErrorBody & { id?: string }>(response)
    if (response.status() === 422) {
      expect(typeof body?.error, 'cap refusal carries a message').toBe('string')
      return String(body?.error)
    }
    expect(response.status(), 'filler create returns 201 below the cap').toBe(201)
    fillers.push(String(body?.id))
  }
  throw new Error(`[internal] Active-schedule cap not reached after ${MAX_FILLERS} creates`)
}

async function expectCapRefusal(response: APIResponse, capMessage: string, context: string): Promise<void> {
  const body = await readJsonSafe<ErrorBody>(response)
  expect(response.status(), `${context} is refused with 422 (body: ${JSON.stringify(body)})`).toBe(422)
  expect(body?.error, `${context} reports the active-schedule cap`).toBe(capMessage)
}

async function cleanup(request: APIRequestContext, token: string | null, ids: Array<string | null>): Promise<void> {
  if (!token) return
  for (const id of ids) await deleteScheduleJob(request, token, id)
}

test.describe('TC-SCHED-010: undo/redo respect the tenant active-schedule cap', () => {
  test.beforeEach(() => {
    skipIfUndoTestsDisabled()
  })

  test('update undo that re-enables a schedule is refused at the cap and allowed below it', async ({ request }) => {
    test.setTimeout(180_000)
    let token: string | null = null
    let jobId: string | null = null
    const fillers: string[] = []
    try {
      token = await getAuthToken(request, 'admin')
      ;({ id: jobId } = await createFixture(request, token))
      await settleAuditClock()

      const disableResponse = await apiRequest(request, 'PUT', SCHEDULER_JOBS_PATH, {
        token,
        data: { id: jobId, isEnabled: false },
      })
      expect(disableResponse.status(), 'disable returns 200').toBe(200)
      const disableOperation = expectOperation(disableResponse, 'scheduler job disable')

      const capMessage = await fillToCap(request, token, fillers)

      await expectCapRefusal(await undoByToken(request, token, disableOperation.undoToken), capMessage, 'update undo at the cap')
      expect((await getScheduleJobById(request, token, jobId))?.isEnabled, 'schedule stays disabled').toBe(false)

      const freedSlotId = fillers.pop() ?? null
      const freeSlotResponse = await apiRequest(request, 'DELETE', SCHEDULER_JOBS_PATH, { token, data: { id: freedSlotId } })
      expect(freeSlotResponse.status(), 'freeing one slot returns 200').toBe(200)
      await undoOk(request, token, disableOperation.undoToken, 'update undo below the cap')
      expect((await getScheduleJobById(request, token, jobId))?.isEnabled, 'schedule re-enabled below the cap').toBe(true)
    } finally {
      await cleanup(request, token, [jobId, ...fillers])
    }
  })

  test('Undo in the last-operation banner shows the cap message and keeps the schedule disabled', async ({ page, request }) => {
    test.setTimeout(240_000)
    let token: string | null = null
    let jobId: string | null = null
    const fillers: string[] = []
    try {
      token = await getAuthToken(request, 'admin')
      ;({ id: jobId } = await createFixture(request, token))
      await settleAuditClock()

      await login(page, 'admin')
      await page.goto(`/backend/config/scheduled-jobs/${jobId}/edit`, { waitUntil: 'domcontentloaded' })
      const enabledSwitch = page.locator('#enabled-switch').first()
      await expect(enabledSwitch).toBeChecked()
      await enabledSwitch.click()
      await expect(enabledSwitch).not.toBeChecked()

      const updateResponsePromise = page.waitForResponse((response) =>
        response.url().includes(SCHEDULER_JOBS_PATH) && response.request().method() === 'PUT',
      )
      await page.getByRole('button', { name: 'Save Changes' }).first().click()
      expect((await updateResponsePromise).ok(), 'UI disable save succeeds').toBeTruthy()
      await expect(page).toHaveURL(/\/backend\/config\/scheduled-jobs$/)
      expect((await getScheduleJobById(request, token, jobId))?.isEnabled, 'schedule disabled from the UI').toBe(false)

      const capMessage = await fillToCap(request, token, fillers)

      const undoButton = page.getByRole('button', { name: /^Undo(?: last action)?$/ })
      await expect(undoButton).toBeVisible()
      const undoResponsePromise = page.waitForResponse((response) =>
        response.url().includes('/api/audit_logs/audit-logs/actions/undo') && response.request().method() === 'POST',
      )
      await undoButton.click()
      expect((await undoResponsePromise).status(), 'banner undo is refused with 422').toBe(422)
      await expect(page.getByText(capMessage, { exact: true }).first()).toBeVisible()
      expect((await getScheduleJobById(request, token, jobId))?.isEnabled, 'schedule stays disabled').toBe(false)
    } finally {
      await cleanup(request, token, [jobId, ...fillers])
    }
  })

  test('delete undo of an enabled schedule is refused at the cap', async ({ request }) => {
    test.setTimeout(180_000)
    let token: string | null = null
    let jobId: string | null = null
    const fillers: string[] = []
    try {
      token = await getAuthToken(request, 'admin')
      ;({ id: jobId } = await createFixture(request, token))
      await settleAuditClock()

      const deleteResponse = await apiRequest(request, 'DELETE', SCHEDULER_JOBS_PATH, { token, data: { id: jobId } })
      expect(deleteResponse.status(), 'delete returns 200').toBe(200)
      const deleteOperation = expectOperation(deleteResponse, 'scheduler job delete')

      const capMessage = await fillToCap(request, token, fillers)

      await expectCapRefusal(await undoByToken(request, token, deleteOperation.undoToken), capMessage, 'delete undo at the cap')
      expect(await getScheduleJobById(request, token, jobId), 'schedule stays deleted').toBeNull()
    } finally {
      await cleanup(request, token, [jobId, ...fillers])
    }
  })

  test('create redo of an enabled schedule is refused at the cap', async ({ request }) => {
    test.setTimeout(180_000)
    let token: string | null = null
    let jobId: string | null = null
    const fillers: string[] = []
    try {
      token = await getAuthToken(request, 'admin')
      const created = await createFixture(request, token)
      jobId = created.id
      const createOperation = expectOperation(created.response, 'scheduler job create')
      await settleAuditClock()

      await undoOk(request, token, createOperation.undoToken, 'create undo')
      expect(await getScheduleJobById(request, token, jobId), 'create undo removes the schedule').toBeNull()

      const capMessage = await fillToCap(request, token, fillers)

      await expectCapRefusal(await redoByLogId(request, token, createOperation.logId), capMessage, 'create redo at the cap')
      expect(await getScheduleJobById(request, token, jobId), 'schedule is not re-created').toBeNull()
    } finally {
      await cleanup(request, token, [jobId, ...fillers])
    }
  })
})
