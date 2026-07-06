import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  buildAssignedUserTaskDefinitionPayload,
  buildClaimableUserTaskDefinitionPayload,
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  findInstanceUserTask,
  startWorkflowInstanceFixture,
  type UserTaskSnapshot,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-024 (issue #2462 scenario TC-WF-015) [P1]: User task list filtering
 *
 * Surface under test: GET /api/workflows/tasks (+ query filters)
 *
 * Filter assertions are scoped by `workflowInstanceId` so they stay deterministic against a
 * shared database (other suites may have their own tasks). The overdue case forces a past
 * `due_date` directly in the DB because there is no API to set it.
 */
type TaskListBody = {
  data?: UserTaskSnapshot[]
  pagination?: { total?: number; limit?: number; offset?: number; hasMore?: boolean }
}

const idsOf = (body: TaskListBody | null): string[] => (body?.data ?? []).map((task) => task.id ?? '')

test.describe('TC-WF-024: user task list filtering (#2462)', () => {
  test('filters tasks by status, assignee, instance, overdue, myTasks and paginates', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const userId = getTokenScope(token).userId
    const timestamp = Date.now()
    const assignedDef = buildAssignedUserTaskDefinitionPayload(timestamp, userId, '-a')
    const claimableDef = buildClaimableUserTaskDefinitionPayload(timestamp, '-b')
    let assignedDefId: string | null = null
    let claimableDefId: string | null = null
    let assignedInstanceId: string | null = null
    let claimableInstanceId: string | null = null

    const listTasks = async (query: string): Promise<TaskListBody | null> => {
      const response = await apiRequest(request, 'GET', `/api/workflows/tasks${query}`, { token })
      expect(response.status(), `GET /api/workflows/tasks${query} should return 200`).toBe(200)
      return readJsonSafe<TaskListBody>(response)
    }

    try {
      assignedDefId = await createWorkflowDefinitionFixture(request, token, assignedDef)
      claimableDefId = await createWorkflowDefinitionFixture(request, token, claimableDef)

      assignedInstanceId = await startWorkflowInstanceFixture(request, token, { workflowId: assignedDef.workflowId })
      claimableInstanceId = await startWorkflowInstanceFixture(request, token, { workflowId: claimableDef.workflowId })

      // TA: assigned directly to the caller (stays PENDING).
      const assignedTask = await findInstanceUserTask(request, token, assignedInstanceId, { statuses: ['PENDING'] })
      expect(assignedTask?.id, 'assigned task should exist').toBeTruthy()
      const assignedTaskId = assignedTask!.id!
      expect(assignedTask?.assignedTo, 'task is assigned to the caller').toBe(userId)

      // TB: role-queue task we claim so it becomes IN_PROGRESS.
      const claimableTask = await findInstanceUserTask(request, token, claimableInstanceId, { statuses: ['PENDING'] })
      expect(claimableTask?.id, 'claimable task should exist').toBeTruthy()
      const claimableTaskId = claimableTask!.id!
      const claimResponse = await apiRequest(
        request,
        'POST',
        `/api/workflows/tasks/${encodeURIComponent(claimableTaskId)}/claim`,
        { token },
      )
      expect(claimResponse.status(), 'claim should return 200').toBe(200)

      // workflowInstanceId scoping narrows to exactly the instance's task.
      const byAssignedInstance = await listTasks(`?workflowInstanceId=${encodeURIComponent(assignedInstanceId)}`)
      expect(idsOf(byAssignedInstance)).toEqual([assignedTaskId])
      const byClaimableInstance = await listTasks(`?workflowInstanceId=${encodeURIComponent(claimableInstanceId)}`)
      expect(idsOf(byClaimableInstance)).toEqual([claimableTaskId])
      expect(byClaimableInstance?.data?.[0]?.status, 'claimed task is IN_PROGRESS').toBe('IN_PROGRESS')

      // status filter (single) within an instance scope.
      const assignedPending = await listTasks(
        `?workflowInstanceId=${encodeURIComponent(assignedInstanceId)}&status=PENDING`,
      )
      expect(idsOf(assignedPending)).toEqual([assignedTaskId])
      const assignedInProgress = await listTasks(
        `?workflowInstanceId=${encodeURIComponent(assignedInstanceId)}&status=IN_PROGRESS`,
      )
      expect(idsOf(assignedInProgress), 'a PENDING task is excluded by status=IN_PROGRESS').toEqual([])
      const claimableInProgress = await listTasks(
        `?workflowInstanceId=${encodeURIComponent(claimableInstanceId)}&status=IN_PROGRESS`,
      )
      expect(idsOf(claimableInProgress)).toEqual([claimableTaskId])

      // status filter (comma-separated union) matches either status.
      const assignedUnion = await listTasks(
        `?workflowInstanceId=${encodeURIComponent(assignedInstanceId)}&status=PENDING,IN_PROGRESS`,
      )
      expect(idsOf(assignedUnion)).toEqual([assignedTaskId])
      const claimableUnion = await listTasks(
        `?workflowInstanceId=${encodeURIComponent(claimableInstanceId)}&status=PENDING,IN_PROGRESS`,
      )
      expect(idsOf(claimableUnion)).toEqual([claimableTaskId])

      // assignedTo filter matches only the directly-assigned task.
      const byAssignee = await listTasks(
        `?workflowInstanceId=${encodeURIComponent(assignedInstanceId)}&assignedTo=${encodeURIComponent(userId)}`,
      )
      expect(idsOf(byAssignee)).toEqual([assignedTaskId])
      const claimableByAssignee = await listTasks(
        `?workflowInstanceId=${encodeURIComponent(claimableInstanceId)}&assignedTo=${encodeURIComponent(userId)}`,
      )
      expect(idsOf(claimableByAssignee), 'a role-queue task is not matched by assignedTo=<user>').toEqual([])

      // myTasks includes a task assigned to the caller.
      const myTasks = await listTasks(
        `?workflowInstanceId=${encodeURIComponent(assignedInstanceId)}&myTasks=true`,
      )
      expect(idsOf(myTasks)).toEqual([assignedTaskId])

      // Pagination: limit caps the page; total/hasMore reflect the full result set.
      const firstPage = await listTasks('?limit=1&offset=0')
      expect((firstPage?.data ?? []).length, 'limit=1 returns at most one item').toBeLessThanOrEqual(1)
      expect(firstPage?.pagination?.limit).toBe(1)
      expect(firstPage?.pagination?.total ?? 0, 'at least the two fixtures exist').toBeGreaterThanOrEqual(2)
      expect(firstPage?.pagination?.hasMore, 'more pages exist beyond limit=1').toBe(true)

      // overdue: force a past due date, then the overdue filter surfaces the PENDING task and
      // still excludes the IN_PROGRESS task that has no due date.
      await withClient(async (client) => {
        await client.query(
          "update user_tasks set due_date = now() - interval '1 day', updated_at = now() where id = $1",
          [assignedTaskId],
        )
      })
      const overdueAssigned = await listTasks(
        `?workflowInstanceId=${encodeURIComponent(assignedInstanceId)}&overdue=true`,
      )
      expect(idsOf(overdueAssigned), 'past-due PENDING task is overdue').toEqual([assignedTaskId])
      const overdueClaimable = await listTasks(
        `?workflowInstanceId=${encodeURIComponent(claimableInstanceId)}&overdue=true`,
      )
      expect(idsOf(overdueClaimable), 'a task without a due date is not overdue').toEqual([])
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, assignedInstanceId)
      await cancelWorkflowInstanceIfExists(request, token, claimableInstanceId)
      await deleteWorkflowDefinitionIfExists(request, token, assignedDefId)
      await deleteWorkflowDefinitionIfExists(request, token, claimableDefId)
    }
  })
})
