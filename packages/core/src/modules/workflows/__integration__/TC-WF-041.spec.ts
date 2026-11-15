import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  buildDecisionUserTaskDefinitionPayload,
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  findInstanceUserTask,
  getUserTaskDetail,
  getWorkflowInstanceSnapshot,
  pollWorkflowInstance,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-041 [P0]: Task decisions select the outgoing route and are recorded
 *
 * Surfaces under test:
 * - GET  /api/workflows/tasks/[id]      (decisions are DERIVED, not stored)
 * - POST /api/workflows/tasks/[id]/complete  (`decisionId`)
 *
 * Real-behavior notes (verified against lib/task-decisions.ts + lib/task-handler.ts):
 * - The BUTTON LIST is derived state. A task reaches its config through
 *   `workflowInstanceId → definition → step.userTaskConfig.decisions`, and the instance pins
 *   its definition version, so the detail route re-resolves the list per request and no
 *   column stores it. Labels are interpolated against the run context at the same moment.
 * - The CHOICE is an audit fact with a different lifetime: it is recorded inside the
 *   completion payload that already exists, under the reserved `__decision` key in
 *   `user_tasks.form_data`, and in the `USER_TASK_COMPLETED` event. Because form data is
 *   merged into the run context, a downstream route condition can branch on it.
 * - A decision is bound to the transition's DURABLE id and is looked up among the routes
 *   LEAVING the step the run is parked on, so a button can never send the run down a route
 *   that starts somewhere else.
 * - An unknown `decisionId` is resolved BEFORE anything is mutated and answered with 400, so
 *   the task is left exactly as it was rather than completed down the wrong route.
 * - The fixture's two routes are `manual`, so completion with no decision finds no `auto`
 *   transition and the instance stays parked. That is what makes "the decision picked the
 *   route" an assertion instead of a coincidence of route order.
 */
test.describe('TC-WF-041: user task decision buttons and routing', () => {
  test('routes each completion down its chosen transition and records the choice', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const defPayload = buildDecisionUserTaskDefinitionPayload(timestamp)
    let definitionId: string | null = null
    let approveInstanceId: string | null = null
    let rejectInstanceId: string | null = null
    let noDecisionInstanceId: string | null = null

    const completeTask = async (
      taskId: string,
      data: Record<string, unknown>,
    ) =>
      apiRequest(request, 'POST', `/api/workflows/tasks/${encodeURIComponent(taskId)}/complete`, {
        token,
        data,
      })

    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, defPayload)

      approveInstanceId = await startWorkflowInstanceFixture(request, token, { workflowId: defPayload.workflowId })
      rejectInstanceId = await startWorkflowInstanceFixture(request, token, { workflowId: defPayload.workflowId })
      noDecisionInstanceId = await startWorkflowInstanceFixture(request, token, { workflowId: defPayload.workflowId })

      const approveTask = await findInstanceUserTask(request, token, approveInstanceId, { statuses: ['PENDING'] })
      const rejectTask = await findInstanceUserTask(request, token, rejectInstanceId, { statuses: ['PENDING'] })
      const parkedTask = await findInstanceUserTask(request, token, noDecisionInstanceId, { statuses: ['PENDING'] })
      expect(approveTask?.id, 'the approve-path instance should park on a task').toBeTruthy()
      expect(rejectTask?.id, 'the reject-path instance should park on a task').toBeTruthy()
      expect(parkedTask?.id, 'the no-decision instance should park on a task').toBeTruthy()

      // The detail route re-resolves the buttons from the pinned definition.
      const detail = await getUserTaskDetail(request, token, approveTask!.id!)
      expect(detail?.stepId, 'the detail names the step the task is parked on').toBe('review')
      expect((detail?.decisions ?? []).map((decision) => decision.id)).toEqual(['approve', 'reject'])
      expect((detail?.decisions ?? []).map((decision) => decision.label)).toEqual(['Approve', 'Reject'])
      expect(detail?.decisions?.[1]?.transitionId, 'each button is bound to a durable route id').toBe('review-to-rejected')

      // An unknown decision is refused before anything is mutated.
      const unknownDecision = await completeTask(rejectTask!.id!, {
        formData: { comments: 'nope' },
        decisionId: 'not-a-decision',
      })
      expect(unknownDecision.status(), 'an unknown decision id is a 400').toBe(400)
      const untouched = await getUserTaskDetail(request, token, rejectTask!.id!)
      expect(untouched?.status, 'the refused completion left the task untouched').toBe('PENDING')
      expect(untouched?.formData ?? null, 'and wrote no completion payload').toBeNull()

      // Reject: the run ends on the END step that route points at.
      const rejectResponse = await completeTask(rejectTask!.id!, {
        formData: { comments: 'not this time' },
        decisionId: 'reject',
      })
      expect(rejectResponse.status(), 'completing with a valid decision returns 200').toBe(200)
      const rejectedInstance = await pollWorkflowInstance(
        request,
        token,
        rejectInstanceId,
        (instance) => instance.status === 'COMPLETED',
      )
      expect(rejectedInstance?.status).toBe('COMPLETED')
      expect(rejectedInstance?.currentStepId, 'the reject button routed to the rejected END step').toBe('rejected')
      expect(
        (rejectedInstance?.context ?? {}).__decision,
        'the choice reached the run context with the rest of the form data',
      ).toBe('reject')
      rejectInstanceId = null // terminal — nothing to cancel

      const completedRejectTask = await getUserTaskDetail(request, token, rejectTask!.id!)
      expect(completedRejectTask?.status).toBe('COMPLETED')
      expect(
        (completedRejectTask?.formData ?? {}).__decision,
        'the chosen decision is recorded on the completion payload',
      ).toBe('reject')

      // Approve: the SAME definition, the other button, the other END step — so the route
      // came from the choice and not from the order the routes were authored in.
      const approveResponse = await completeTask(approveTask!.id!, {
        formData: { comments: 'looks good' },
        decisionId: 'approve',
      })
      expect(approveResponse.status()).toBe(200)
      const approvedInstance = await pollWorkflowInstance(
        request,
        token,
        approveInstanceId,
        (instance) => instance.status === 'COMPLETED',
      )
      expect(approvedInstance?.currentStepId, 'the approve button routed to the approved END step').toBe('approved')
      approveInstanceId = null

      // No decision: nothing auto-routes out of the step, so the run stays where it was.
      const parkedResponse = await completeTask(parkedTask!.id!, { formData: { comments: 'no button pressed' } })
      expect(parkedResponse.status(), 'a task with decisions still completes through the plain form').toBe(200)
      const parkedCompleted = await getUserTaskDetail(request, token, parkedTask!.id!)
      expect(parkedCompleted?.status).toBe('COMPLETED')
      expect(
        (parkedCompleted?.formData ?? {}).__decision ?? null,
        'nothing is recorded when no button was pressed',
      ).toBeNull()
      const parkedInstance = await getWorkflowInstanceSnapshot(request, token, noDecisionInstanceId)
      expect(parkedInstance?.currentStepId, 'with no auto route the run stays on the task step').toBe('review')
      expect(parkedInstance?.status, 'and stays parked rather than completing').not.toBe('COMPLETED')
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, approveInstanceId)
      await cancelWorkflowInstanceIfExists(request, token, rejectInstanceId)
      await cancelWorkflowInstanceIfExists(request, token, noDecisionInstanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
