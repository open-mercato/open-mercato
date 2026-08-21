import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  buildClaimableUserTaskDefinitionPayload,
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  findInstanceUserTask,
  pollWorkflowInstance,
  startWorkflowInstanceFixture,
  type UserTaskSnapshot,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-023 (issue #2462 scenario TC-WF-014) [P0]: User task claim + complete API flow
 *
 * Surfaces under test:
 * - POST /api/workflows/tasks/[id]/claim
 * - POST /api/workflows/tasks/[id]/complete
 * - GET  /api/workflows/tasks/[id]
 *
 * Real-behavior notes (verified against task-handler.ts + the route error mapping):
 * - `claimUserTask` only matches a PENDING task and requires it to be queued to a role
 *   (assignedToRoles non-empty, assignedTo null). The claimable fixture uses the array form
 *   of `assignedTo` which the step handler stores as a role queue.
 * - Re-claiming an already-claimed (IN_PROGRESS) task throws "Task not found or already
 *   claimed"; the route checks the 'not found' substring before 'already', so the response
 *   is 404 (NOT the 409 the issue assumed).
 */
test.describe('TC-WF-023: user task claim and complete API flow (#2462)', () => {
  test('claims a role-queue task, completes it, and resumes the workflow', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const userId = getTokenScope(token).userId
    const timestamp = Date.now()
    const defPayload = buildClaimableUserTaskDefinitionPayload(timestamp)
    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, defPayload)
      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: defPayload.workflowId,
        initialContext: { orderId: `order-${timestamp}` },
      })

      // The instance pauses at the USER_TASK; the PENDING task is created asynchronously
      // by the background executor, so poll for it.
      const pendingTask = await findInstanceUserTask(request, token, instanceId, { statuses: ['PENDING'] })
      expect(pendingTask?.id, 'a PENDING user task should be created for the instance').toBeTruthy()
      const taskId = pendingTask!.id!
      expect(pendingTask?.status).toBe('PENDING')
      expect(pendingTask?.assignedTo ?? null, 'a role-queue task is not assigned to a specific user').toBeNull()
      expect(pendingTask?.assignedToRoles ?? [], 'task is queued to the admin role').toContain('admin')

      // CLAIM — task moves to IN_PROGRESS and is attributed to the caller.
      const claimResponse = await apiRequest(
        request,
        'POST',
        `/api/workflows/tasks/${encodeURIComponent(taskId)}/claim`,
        { token },
      )
      expect(claimResponse.status(), `claim should return 200 (got ${claimResponse.status()})`).toBe(200)
      const claimBody = await readJsonSafe<{ data?: UserTaskSnapshot }>(claimResponse)
      expect(claimBody?.data?.status).toBe('IN_PROGRESS')
      expect(claimBody?.data?.claimedBy).toBe(userId)

      // GET detail reflects the claimed state.
      const detailResponse = await apiRequest(
        request,
        'GET',
        `/api/workflows/tasks/${encodeURIComponent(taskId)}`,
        { token },
      )
      expect(detailResponse.status(), 'GET task detail should return 200').toBe(200)
      const detailBody = await readJsonSafe<{ data?: UserTaskSnapshot }>(detailResponse)
      expect(detailBody?.data?.status).toBe('IN_PROGRESS')
      expect(detailBody?.data?.claimedBy).toBe(userId)

      // Re-claiming an already-claimed task returns 404 (see real-behavior note above).
      const reclaimResponse = await apiRequest(
        request,
        'POST',
        `/api/workflows/tasks/${encodeURIComponent(taskId)}/claim`,
        { token },
      )
      expect(reclaimResponse.status(), 'claiming an already-claimed task returns 404').toBe(404)

      // COMPLETE — submit valid form data; task moves to COMPLETED.
      const completeResponse = await apiRequest(
        request,
        'POST',
        `/api/workflows/tasks/${encodeURIComponent(taskId)}/complete`,
        { token, data: { formData: { approved: true, comments: 'qa-approved' } } },
      )
      expect(completeResponse.status(), `complete should return 200 (got ${completeResponse.status()})`).toBe(200)
      const completeBody = await readJsonSafe<{ data?: UserTaskSnapshot }>(completeResponse)
      expect(completeBody?.data?.status).toBe('COMPLETED')
      expect(completeBody?.data?.completedBy).toBe(userId)
      expect(completeBody?.data?.completedAt, 'completedAt should be set').toBeTruthy()

      // The `review -> end` auto transition resumes the instance to COMPLETED.
      const finalInstance = await pollWorkflowInstance(
        request,
        token,
        instanceId,
        (instance) => instance.status === 'COMPLETED',
      )
      expect(finalInstance?.status, 'instance should resume past the USER_TASK and complete').toBe('COMPLETED')
      instanceId = null // terminal — nothing to cancel
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })

  test('completing a missing task returns 404', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(
      request,
      'POST',
      `/api/workflows/tasks/${encodeURIComponent('00000000-0000-4000-8000-000000000000')}/complete`,
      { token, data: { formData: { approved: true } } },
    )
    expect(response.status(), 'completing a non-existent task returns 404').toBe(404)
  })
})
