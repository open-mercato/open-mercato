import { expect, test } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  findInstanceUserTask,
  startWorkflowInstanceFixture,
  type UserTaskSnapshot,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-047 [P1]: a task with no assignee, no claim and no role queue belongs to
 * nobody — it is uncompletable, and reassignment is the documented rescue.
 *
 * Spec `.ai/specs/2026-07-26-workflows-ux-redesign.md` §6.4.
 *
 * Surfaces under test:
 * - POST /api/workflows/definitions   (the owner-less shape must still SAVE)
 * - GET  /api/workflows/tasks/[id]
 * - POST /api/workflows/tasks/[id]/complete
 * - POST /api/workflows/tasks/[id]/reassign
 *
 * Three deliberate decisions meet here, and each one is asserted rather than
 * assumed:
 *
 * 1. **The definition still saves.** `ownerless USER_TASK` is an author-time
 *    Problems **warning**, not a save-blocking error. Making it an error would
 *    have made every definition authored before the rule existed unsaveable —
 *    including one shipped gallery template. The `createWorkflowDefinitionFixture`
 *    call below is the assertion: it fails the test if the POST is refused.
 * 2. **The task is genuinely uncompletable.** Before §6.4 the handler left an
 *    owner-less row open to anyone holding `workflows.tasks.complete`; now the
 *    act gate answers `403 TASK_NOT_ACTIONABLE` and names the remedy. That is a
 *    real behaviour change and a real (small) footgun, which is why it is
 *    documented rather than papered over.
 * 3. **`reassign` gates on VISIBILITY, not ownership.** Requiring ownership
 *    would make the unrescuable row unrescuable by definition. The admin below
 *    owns nothing on this task and must still be able to take it.
 */

function buildOwnerlessUserTaskDefinitionPayload(timestamp: number) {
  const id = `qa-wf-ownerless-${timestamp}`
  return {
    workflowId: id,
    workflowName: `QA Ownerless User Task ${timestamp}`,
    description: `Integration test definition ${id}`,
    version: 1,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        {
          stepId: 'review',
          stepName: 'Review',
          stepType: 'USER_TASK',
          // No `assignedTo`, no `assignedToRoles` — nobody's work.
          userTaskConfig: {
            formSchema: { properties: { approved: { type: 'boolean' } } },
          },
        },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 'start-to-review', fromStepId: 'start', toStepId: 'review', trigger: 'auto' },
        { transitionId: 'review-to-end', fromStepId: 'review', toStepId: 'end', trigger: 'auto' },
      ],
    },
    enabled: true,
  }
}

test.describe('TC-WF-047: an owner-less task is uncompletable until it is reassigned', () => {
  test('refuses completion with TASK_NOT_ACTIONABLE, then completes after reassign-to-self', async ({ request }) => {
    test.setTimeout(90_000)

    const adminToken = await getAuthToken(request, 'admin')
    const adminUserId = getTokenScope(adminToken).userId
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`

    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      const definitionPayload = buildOwnerlessUserTaskDefinitionPayload(Date.now())
      // Assertion 1: an owner-less USER_TASK is a warning, not an error.
      definitionId = await createWorkflowDefinitionFixture(request, adminToken, definitionPayload)

      instanceId = await startWorkflowInstanceFixture(request, adminToken, {
        workflowId: definitionPayload.workflowId,
        initialContext: { stamp },
      })

      const created = await findInstanceUserTask(request, adminToken, instanceId, { statuses: ['PENDING'] })
      expect(created?.id, 'the USER_TASK step creates a PENDING task').toBeTruthy()
      const taskId = created!.id!
      expect(created?.assignedTo ?? null, 'the task has no assignee').toBeNull()
      expect(created?.assignedToRoles ?? null, 'the task has no role queue').toBeNull()
      expect(created?.claimedBy ?? null, 'the task has no claimant').toBeNull()

      const detailPath = `/api/workflows/tasks/${encodeURIComponent(taskId)}`

      // The admin's `workflows.*` wildcard matches `workflows.tasks.view_all`,
      // so administration sees the row — that half is unchanged.
      const detail = await apiRequest(request, 'GET', detailPath, { token: adminToken })
      expect(detail.status(), 'an administrator sees the owner-less row').toBe(200)

      // Assertion 2: seeing it is not owning it.
      const refused = await apiRequest(request, 'POST', `${detailPath}/complete`, {
        token: adminToken,
        data: { formData: { approved: true } },
      })
      expect(refused.status(), 'an owner-less task cannot be completed by anyone').toBe(403)
      const refusedBody = await readJsonSafe<{ code?: string; error?: string }>(refused)
      expect(refusedBody?.code, 'the refusal names its own remedy').toBe('TASK_NOT_ACTIONABLE')

      // Assertion 3: reassignment rescues it even though the caller owns nothing.
      const reassign = await apiRequest(request, 'POST', `${detailPath}/reassign`, {
        token: adminToken,
        data: { assignedTo: adminUserId, reason: 'QA TC-WF-047: rescuing an owner-less task' },
      })
      expect(reassign.status(), 'reassign gates on visibility, not on ownership').toBe(200)
      const reassigned = await readJsonSafe<{ data?: UserTaskSnapshot & { reassignedBy?: string | null } }>(reassign)
      expect(reassigned?.data?.assignedTo).toBe(adminUserId)
      expect(reassigned?.data?.reassignedBy).toBe(adminUserId)

      const completed = await apiRequest(request, 'POST', `${detailPath}/complete`, {
        token: adminToken,
        data: { formData: { approved: true } },
      })
      expect(completed.status(), 'once it has an owner it completes normally').toBe(200)
      const completedBody = await readJsonSafe<{ data?: UserTaskSnapshot }>(completed)
      expect(completedBody?.data?.status).toBe('COMPLETED')
      expect(completedBody?.data?.completedBy).toBe(adminUserId)
    } finally {
      await cancelWorkflowInstanceIfExists(request, adminToken, instanceId)
      await deleteWorkflowDefinitionIfExists(request, adminToken, definitionId)
    }
  })
})
