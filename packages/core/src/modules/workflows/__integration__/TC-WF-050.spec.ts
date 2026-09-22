import { expect, test } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  buildAssignedUserTaskDefinitionPayload,
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  findInstanceUserTask,
  getUserTaskDetail,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-050 [P1] (UI): an assignee opens a task deep link and completes it
 * without ever loading the inbox list.
 *
 * Spec `.ai/specs/2026-07-26-workflows-ux-redesign.md` §6.4; design §10.4.
 *
 * Surface: `/backend/tasks/[id]` (the target of the task-assignment
 * notification's deep link).
 *
 * Single-task READ is relationship-based, not list-derived, which is what makes
 * a notification deep link keep working after the §6.4 narrowing: the page
 * fetches `GET /api/workflows/tasks/[id]` directly and the predicate admits the
 * assignee on the assignment alone. A regression that only filtered the LIST
 * would pass every list-based test and still break every notification link, so
 * this spec deliberately navigates straight to the detail URL.
 *
 * The completion is asserted twice — the form disappears in the browser, and the
 * API confirms `COMPLETED` — so the test does not depend on any translated
 * string.
 *
 * NOTE on the other design §10.4 case (a `view_all` supervisor seeing a
 * colleague's task with the Complete button ABSENT): it is deliberately not
 * written here because the shipped backoffice detail response carries no
 * `canComplete` field — the page derives `isCompletable` from status alone, so
 * the button renders for an administrator and the refusal happens server-side.
 * The server-side refusal IS covered (TC-WF-045: `409
 * TASK_ASSIGNED_TO_ANOTHER_USER`). Hiding the button — and adding a reassign
 * control to the page, which also does not exist yet — is recorded as a
 * follow-up in the run's SECURITY-REVIEW.md rather than asserted here against
 * code that does not implement it.
 */

test.describe('TC-WF-050: completing a task straight from its deep link', () => {
  test('the assignee opens /backend/tasks/[id] and completes without visiting the inbox', async ({ page, request }) => {
    test.setTimeout(90_000)

    const adminToken = await getAuthToken(request, 'admin')
    const adminUserId = getTokenScope(adminToken).userId
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`

    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      const definitionPayload = buildAssignedUserTaskDefinitionPayload(Date.now(), adminUserId, '-deeplink')
      definitionId = await createWorkflowDefinitionFixture(request, adminToken, definitionPayload)
      instanceId = await startWorkflowInstanceFixture(request, adminToken, {
        workflowId: definitionPayload.workflowId,
        initialContext: { stamp },
      })

      const created = await findInstanceUserTask(request, adminToken, instanceId, { statuses: ['PENDING'] })
      expect(created?.id, 'the USER_TASK step creates a PENDING task').toBeTruthy()
      const taskId = created!.id!

      await login(page, 'admin')

      // Straight to the deep link — the inbox list is never loaded.
      await page.goto(`/backend/tasks/${taskId}`)

      const completeButton = page.getByTestId('task-complete')
      await expect(completeButton, 'the assignee is offered the completion form').toBeVisible()

      await completeButton.click()

      await expect(
        completeButton,
        'the completed task re-renders without the completion form',
      ).toBeHidden()

      const detail = await getUserTaskDetail(request, adminToken, taskId)
      expect(detail?.status, 'the completion reached the API').toBe('COMPLETED')
      expect(detail?.completedBy).toBe(adminUserId)
    } finally {
      await cancelWorkflowInstanceIfExists(request, adminToken, instanceId)
      await deleteWorkflowDefinitionIfExists(request, adminToken, definitionId)
    }
  })
})
