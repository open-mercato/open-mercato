import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  buildInspectorUserTaskDefinitionPayload,
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  findInstanceUserTask,
  getUserTaskDetail,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-042 [P0]: Authored task configuration survives a definition save round trip (A1)
 *
 * Surfaces under test:
 * - POST /api/workflows/definitions
 * - GET  /api/workflows/definitions/[id]
 * - PUT  /api/workflows/definitions/[id]   (the save that used to discard the config)
 * - GET  /api/workflows/tasks/[id]
 *
 * Real-behavior notes (the defect this pins, verified against data/validators.ts):
 * - `userTaskConfigSchema` did not declare `assignedToRoles`, `formKey` or `allowedActions`.
 *   The editor wrote them and the engine read them, but zod STRIPS undeclared keys and both
 *   the definition POST and PUT persist the PARSED value — so role assignment authored in
 *   the Studio was silently dropped on every save. Nothing failed and nothing warned; the
 *   task simply came out queued to nobody.
 * - This is a round-trip test on purpose. Asserting the create response alone would not have
 *   caught it in every shape, and the PUT is the path an author actually takes: open, edit
 *   something unrelated, save.
 * - The rest of the §6.1 vocabulary (`instructions`, `priority`, `deadline`, `entityBindings`,
 *   `decisions`, `editablePrefilled`) is additive and travels the same parse, so it is
 *   asserted here too — a future key added without a schema entry would fail this test.
 * - `assignedToRoles` holds role NAMES, not ids: the editor emits names, the engine copies
 *   them onto the task and `claimUserTask` compares them against the caller's role names.
 *   A role RENAME therefore orphans existing assignments; migrating to ids is a coordinated
 *   data + authored-definition change and is deliberately not part of this test.
 */
type DefinitionDetail = {
  data?: {
    definition?: {
      steps?: Array<{
        stepId?: string
        userTaskConfig?: Record<string, unknown>
      }>
    }
  }
}

const AUTHORED_TASK_CONFIG = {
  assignedToRoles: ['admin'],
  formKey: 'qa.task.renderer',
  allowedActions: ['complete', 'cancel'],
  instructions: 'Check the record and decide.',
  priority: 'high',
  deadline: { duration: 'PT30M' },
  reminders: [{ offset: 'PT10M' }],
  editablePrefilled: ['approved'],
  formSchema: { properties: { approved: { type: 'boolean' } }, required: ['approved'] },
} as const

test.describe('TC-WF-042: authored user task config survives a save round trip (A1)', () => {
  test('keeps assignedToRoles, formKey and allowedActions through create, save and task creation', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const defPayload = buildInspectorUserTaskDefinitionPayload(timestamp, {
      suffix: '-a1',
      userTaskConfig: { ...AUTHORED_TASK_CONFIG },
    })
    let definitionId: string | null = null
    let instanceId: string | null = null

    const readTaskConfig = async (label: string): Promise<Record<string, unknown>> => {
      const response = await apiRequest(
        request,
        'GET',
        `/api/workflows/definitions/${encodeURIComponent(definitionId!)}`,
        { token },
      )
      expect(response.status(), `GET definition after ${label} should return 200`).toBe(200)
      const body = await readJsonSafe<DefinitionDetail>(response)
      const step = (body?.data?.definition?.steps ?? []).find((candidate) => candidate.stepId === 'review')
      expect(step?.userTaskConfig, `the task step should still carry its config after ${label}`).toBeTruthy()
      return step!.userTaskConfig!
    }

    const expectAuthoredConfig = (config: Record<string, unknown>, label: string): void => {
      expect(config.assignedToRoles, `role assignment survives ${label}`).toEqual(['admin'])
      expect(config.formKey, `the renderer key survives ${label}`).toBe('qa.task.renderer')
      expect(config.allowedActions, `the allowed actions survive ${label}`).toEqual(['complete', 'cancel'])
      expect(config.instructions, `the instructions survive ${label}`).toBe('Check the record and decide.')
      expect(config.priority, `the priority survives ${label}`).toBe('high')
      expect(config.deadline, `the deadline survives ${label}`).toEqual({ duration: 'PT30M' })
      expect(config.reminders, `the reminders survive ${label}`).toEqual([{ offset: 'PT10M' }])
      expect(config.editablePrefilled, `the editable prefilled fields survive ${label}`).toEqual(['approved'])
    }

    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, defPayload)
      expectAuthoredConfig(await readTaskConfig('create'), 'create')

      // The save round trip: PUT the definition back the way the Studio does.
      const saveResponse = await apiRequest(
        request,
        'PUT',
        `/api/workflows/definitions/${encodeURIComponent(definitionId)}`,
        { token, data: { description: `Saved again ${timestamp}`, definition: defPayload.definition } },
      )
      expect(saveResponse.status(), 'saving the definition should return 200').toBe(200)
      expectAuthoredConfig(await readTaskConfig('save'), 'save')

      // And the engine reads what was saved: the created task carries the role queue.
      instanceId = await startWorkflowInstanceFixture(request, token, { workflowId: defPayload.workflowId })
      const task = await findInstanceUserTask(request, token, instanceId, { statuses: ['PENDING'] })
      expect(task?.id, 'the instance should park on a task').toBeTruthy()
      expect(task?.assignedToRoles, 'the created task is queued to the authored role').toEqual(['admin'])
      expect(task?.assignedTo ?? null, 'a role-queue task has no individual assignee').toBeNull()
      expect(task?.priority, 'the authored priority is promoted to its own column').toBe('high')
      expect(task?.dueDate, 'the authored deadline resolved to an absolute due date').toBeTruthy()

      // PT30M means thirty minutes (A9): the old parser silently made it a day.
      const dueInMinutes = (Date.parse(task!.dueDate!) - Date.now()) / 60_000
      expect(dueInMinutes, 'PT30M is thirty minutes, not a day').toBeGreaterThan(20)
      expect(dueInMinutes, 'PT30M is thirty minutes, not a day').toBeLessThan(40)

      // The renderer key reaches the task surface, re-resolved from the pinned definition
      // rather than copied onto a column.
      const detail = await getUserTaskDetail(request, token, task!.id!)
      expect(detail?.formKey, 'the task detail exposes the authored renderer key').toBe('qa.task.renderer')
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
