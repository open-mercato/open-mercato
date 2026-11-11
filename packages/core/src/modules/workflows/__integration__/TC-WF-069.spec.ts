import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  buildInspectorUserTaskDefinitionPayload,
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  findInstanceUserTask,
  listWorkflowInstanceEvents,
  listWorkflowInstanceSteps,
  listWorkflowInstanceTasks,
  pollWorkflowInstance,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'
import {
  workflowDefinitionDetailResponseSchema,
  workflowDefinitionListResponseSchema,
  workflowDefinitionMutationResponseSchema,
} from '@open-mercato/core/modules/workflows/api/openapi'

/**
 * TC-WF-069 [P1]: an absolute USER_TASK deadline (`userTaskConfig.deadlineAt`) resolved from
 * the run context (#7181).
 *
 * Spec `.ai/specs/2026-07-26-workflows-ux-redesign.md` §6.1 "When" (Changelog 2026-10-11).
 *
 * Surfaces under test:
 * - POST /api/workflows/definitions        (save-time `deadline` XOR `deadlineAt`)
 * - PUT  /api/workflows/definitions/[id]   (authoring the absolute deadline on update)
 * - GET  /api/workflows/definitions[/id]   (the published response contract)
 * - POST /api/workflows/instances          (the deadline resolves at task creation)
 * - GET  /api/workflows/tasks              (the task's `dueDate`)
 * - GET  /api/workflows/instances/[id]     (the fail-closed verdict)
 * - GET  /api/workflows/instances/[id]/steps and /events
 *
 * What is asserted, and why each half matters:
 *
 * 1. **An ISO date means the END of that day in UTC.** "Due on the 20th" must
 *    not breach at its first minute, so `YYYY-MM-DD` becomes `23:59:59.999Z`.
 * 2. **A datetime keeps its offset.** `T17:00:00+02:00` is `15:00:00.000Z`, not
 *    17:00 in whatever timezone the worker happens to run in.
 * 3. **An unresolved or unparseable value fails closed.** A wrong deadline
 *    silently mis-schedules every reminder and the breach, so the step fails
 *    with `INVALID_USER_TASK_DEADLINE` and NO task row is created. The error
 *    code itself is not persisted on any read surface; the step's `errorData`
 *    carries the engine's message and the `{ stepId, deadlineAt, resolved, i18n }`
 *    details the code is thrown with, and those are what is asserted.
 * 4. **`deadline` and `deadlineAt` are mutually exclusive** — refused on save,
 *    not left for the engine to pick one.
 * 5. **The refusal is localized.** The deadline diagnostics are user-facing, so
 *    a Polish request reads the Polish message in `details[].message`.
 * 6. **Old readers keep working.** `deadline` stays duration-only, so every
 *    definition response carrying an absolute deadline still parses with the
 *    list/detail/mutation response schemas these routes have always published.
 */

const DEADLINE_TEMPLATE = '{{context.dueDate}}'
const POLISH_BOTH_FORMS_MESSAGE =
  'Termin zadania to albo "deadline" (czas trwania), albo "deadlineAt" (data bezwzględna) — nie oba naraz'
const INVALID_DEADLINE_AT_MESSAGE = 'Invalid user task "deadlineAt"'
const DAY_MS = 24 * 60 * 60 * 1000

function isoDateInDays(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10)
}

function buildAbsoluteDeadlineDefinition(stamp: string, suffix: string, deadlineConfig: Record<string, unknown>) {
  return buildInspectorUserTaskDefinitionPayload(Date.now(), {
    suffix: `-deadline-at-${suffix}-${stamp}`,
    userTaskConfig: {
      assignedToRoles: ['admin'],
      formSchema: { properties: { approved: { type: 'boolean' } } },
      ...deadlineConfig,
      reminders: [{ offset: 'P1D' }],
    },
  })
}

async function startAndReadDueDate(
  request: APIRequestContext,
  token: string,
  workflowId: string,
  dueDate: string,
  instanceIds: string[],
): Promise<string | null | undefined> {
  const instanceId = await startWorkflowInstanceFixture(request, token, {
    workflowId,
    initialContext: { dueDate },
  })
  instanceIds.push(instanceId)
  const task = await findInstanceUserTask(request, token, instanceId, { statuses: ['PENDING'] })
  expect(task?.id, `the USER_TASK step creates a PENDING task for dueDate=${dueDate}`).toBeTruthy()
  return task?.dueDate
}

test.describe('TC-WF-069: absolute user-task deadline (deadlineAt) from the run context', () => {
  test('resolves an ISO date and an offset datetime from context into the task dueDate', async ({ request }) => {
    test.setTimeout(90_000)

    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    let definitionId: string | null = null
    const instanceIds: string[] = []

    try {
      const definition = buildAbsoluteDeadlineDefinition(stamp, 'ok', { deadlineAt: DEADLINE_TEMPLATE })
      definitionId = await createWorkflowDefinitionFixture(request, token, definition)

      const dateOnly = isoDateInDays(5)
      const dateOnlyDue = await startAndReadDueDate(request, token, definition.workflowId, dateOnly, instanceIds)
      expect(dateOnlyDue, 'an ISO date is due at the end of that day in UTC').toBe(`${dateOnly}T23:59:59.999Z`)

      const datetimeDay = isoDateInDays(7)
      const datetimeDue = await startAndReadDueDate(
        request,
        token,
        definition.workflowId,
        `${datetimeDay}T17:00:00+02:00`,
        instanceIds,
      )
      expect(datetimeDue, 'a datetime with an offset keeps that offset').toBe(`${datetimeDay}T15:00:00.000Z`)
    } finally {
      for (const instanceId of instanceIds) {
        await cancelWorkflowInstanceIfExists(request, token, instanceId)
      }
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })

  test('fails the instance closed with no task when deadlineAt is missing or not an instant', async ({ request }) => {
    test.setTimeout(90_000)

    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    let definitionId: string | null = null
    const instanceIds: string[] = []

    try {
      const definition = buildAbsoluteDeadlineDefinition(stamp, 'bad', { deadlineAt: DEADLINE_TEMPLATE })
      definitionId = await createWorkflowDefinitionFixture(request, token, definition)

      const cases: Array<{ label: string; initialContext: Record<string, unknown>; resolved: string }> = [
        { label: 'an unresolved template', initialContext: { stamp }, resolved: DEADLINE_TEMPLATE },
        { label: 'free text', initialContext: { stamp, dueDate: 'soon' }, resolved: 'soon' },
        {
          label: 'a naive datetime without an offset',
          initialContext: { stamp, dueDate: `${isoDateInDays(5)}T17:00:00` },
          resolved: `${isoDateInDays(5)}T17:00:00`,
        },
      ]

      for (const { label, initialContext, resolved } of cases) {
        const instanceId = await startWorkflowInstanceFixture(request, token, {
          workflowId: definition.workflowId,
          initialContext,
        })
        instanceIds.push(instanceId)

        const failed = await pollWorkflowInstance(
          request,
          token,
          instanceId,
          (instance) => instance.status === 'FAILED' || instance.status === 'COMPLETED',
          { timeoutMs: 15_000 },
        )
        expect(failed?.status, `${label}: the instance fails closed`).toBe('FAILED')
        const failedBody = failed as { errorMessage?: string | null; errorDetails?: Record<string, unknown> | null } | null
        expect(failedBody?.errorMessage ?? '', `${label}: the instance names the deadline`).toContain(
          INVALID_DEADLINE_AT_MESSAGE,
        )
        expect(failedBody?.errorDetails?.i18n, `${label}: the run views can localize the failure`).toEqual({
          key: 'workflows.validation.taskDeadline.invalidResolvedAt',
          params: { authored: DEADLINE_TEMPLATE, resolved },
        })

        const steps = await listWorkflowInstanceSteps(request, token, instanceId)
        const reviewStep = steps.find((step) => step.stepId === 'review')
        expect(reviewStep?.status, `${label}: the USER_TASK step is FAILED`).toBe('FAILED')
        const errorData = reviewStep?.errorData as
          | { error?: string; details?: Record<string, unknown> }
          | null
          | undefined
        expect(errorData?.error ?? '', `${label}: the step error is the deadline error`).toContain(
          INVALID_DEADLINE_AT_MESSAGE,
        )
        expect(errorData?.details, `${label}: INVALID_USER_TASK_DEADLINE details`).toEqual({
          stepId: 'review',
          deadlineAt: DEADLINE_TEMPLATE,
          resolved,
          i18n: {
            key: 'workflows.validation.taskDeadline.invalidResolvedAt',
            params: { authored: DEADLINE_TEMPLATE, resolved },
          },
        })

        const stepFailed = await listWorkflowInstanceEvents(request, token, instanceId, { eventType: 'STEP_FAILED' })
        expect(
          stepFailed.some((event) => event.eventData?.stepId === 'review'),
          `${label}: a STEP_FAILED event is logged for the USER_TASK step`,
        ).toBe(true)

        const tasks = await listWorkflowInstanceTasks(request, token, instanceId)
        expect(tasks, `${label}: no task row is created for an invalid deadline`).toHaveLength(0)
      }
    } finally {
      for (const instanceId of instanceIds) {
        await cancelWorkflowInstanceIfExists(request, token, instanceId)
      }
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })

  test('refuses to save a step that declares both deadline and deadlineAt', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    let definitionId: string | null = null

    try {
      const definition = buildAbsoluteDeadlineDefinition(stamp, 'both', {
        deadline: { duration: 'P3D' },
        deadlineAt: DEADLINE_TEMPLATE,
      })
      const response = await apiRequest(request, 'POST', '/api/workflows/definitions', { token, data: definition })
      const body = await readJsonSafe<{
        data?: { id?: string }
        error?: string
        details?: Array<{ path?: Array<string | number>; message?: string }>
      }>(response)
      definitionId = body?.data?.id ?? null

      expect(response.status(), `deadline + deadlineAt must be refused on save (got ${JSON.stringify(body)})`).toBe(400)
      const issue = body?.details?.find((detail) => detail.path?.join('.').endsWith('userTaskConfig.deadlineAt'))
      expect(issue?.message, 'the refusal points at deadlineAt and says why').toContain('not both')
    } finally {
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })

  test('localizes the deadline refusal for the request locale', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    let definitionId: string | null = null

    try {
      const definition = buildAbsoluteDeadlineDefinition(stamp, 'both-pl', {
        deadline: { duration: 'P3D' },
        deadlineAt: DEADLINE_TEMPLATE,
      })
      const response = await apiRequest(request, 'POST', '/api/workflows/definitions', {
        token,
        data: definition,
        headers: { Cookie: 'locale=pl', 'Accept-Language': 'pl' },
      })
      const body = await readJsonSafe<{
        data?: { id?: string }
        details?: Array<{ path?: Array<string | number>; message?: string }>
      }>(response)
      definitionId = body?.data?.id ?? null

      expect(response.status(), `deadline + deadlineAt must be refused on save (got ${JSON.stringify(body)})`).toBe(400)
      const issue = body?.details?.find((detail) => detail.path?.join('.').endsWith('userTaskConfig.deadlineAt'))
      expect(issue?.message, 'a Polish request reads the Polish deadline diagnostic').toBe(POLISH_BOTH_FORMS_MESSAGE)
    } finally {
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })

  test('keeps the published definition response contract for old readers', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    let definitionId: string | null = null
    const reviewConfig = (row: { definition?: { steps?: Array<{ stepId?: string; userTaskConfig?: unknown }> } }) =>
      row.definition?.steps?.find((step) => step.stepId === 'review')?.userTaskConfig as
        | Record<string, unknown>
        | undefined

    try {
      const definition = buildAbsoluteDeadlineDefinition(stamp, 'contract', { deadlineAt: DEADLINE_TEMPLATE })
      const created = await apiRequest(request, 'POST', '/api/workflows/definitions', { token, data: definition })
      const createdBody = await readJsonSafe<Record<string, unknown> & { data?: { id?: string } }>(created)
      definitionId = createdBody?.data?.id ?? null
      expect(created.status(), `POST accepts deadlineAt (got ${JSON.stringify(createdBody)})`).toBe(201)
      expect(workflowDefinitionMutationResponseSchema.safeParse(createdBody).error?.issues ?? []).toEqual([])

      const absoluteDate = isoDateInDays(9)
      const updatedDefinition = buildAbsoluteDeadlineDefinition(stamp, 'contract', { deadlineAt: absoluteDate })
      const updated = await apiRequest(request, 'PUT', `/api/workflows/definitions/${definitionId}`, {
        token,
        data: { definition: updatedDefinition.definition },
      })
      const updatedBody = await readJsonSafe<Record<string, unknown> & { data?: Record<string, unknown> }>(updated)
      expect(updated.status(), `PUT accepts deadlineAt (got ${JSON.stringify(updatedBody)})`).toBe(200)
      expect(workflowDefinitionMutationResponseSchema.safeParse(updatedBody).error?.issues ?? []).toEqual([])
      expect(reviewConfig(updatedBody?.data ?? {})).toMatchObject({ deadlineAt: absoluteDate })

      const detail = await apiRequest(request, 'GET', `/api/workflows/definitions/${definitionId}`, { token })
      const detailBody = await readJsonSafe<Record<string, unknown> & { data?: Record<string, unknown> }>(detail)
      expect(detail.status()).toBe(200)
      expect(workflowDefinitionDetailResponseSchema.safeParse(detailBody).error?.issues ?? []).toEqual([])
      const detailConfig = reviewConfig(detailBody?.data ?? {})
      expect(detailConfig).toMatchObject({ deadlineAt: absoluteDate })
      expect(detailConfig, 'deadline is never written in an at-only form').not.toHaveProperty('deadline')

      const list = await apiRequest(
        request,
        'GET',
        `/api/workflows/definitions?workflowId=${encodeURIComponent(definition.workflowId)}`,
        { token },
      )
      const listBody = await readJsonSafe<Record<string, unknown> & { data?: Array<Record<string, unknown>> }>(list)
      expect(list.status()).toBe(200)
      expect(workflowDefinitionListResponseSchema.safeParse(listBody).error?.issues ?? []).toEqual([])
      const listed = listBody?.data?.find((row) => row.id === definitionId)
      expect(listed, 'the list returns the authored definition').toBeTruthy()
      expect(reviewConfig(listed ?? {})).toMatchObject({ deadlineAt: absoluteDate })
    } finally {
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
