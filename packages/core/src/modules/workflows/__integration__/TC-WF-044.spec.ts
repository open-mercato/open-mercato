import { expect, test } from '@playwright/test'
import { randomInt, randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  buildAssignedUserTaskDefinitionPayload,
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  findInstanceUserTask,
  startWorkflowInstanceFixture,
  type UserTaskSnapshot,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-044 [P0]: assignment is the grant — a task is visible and completable to
 * its assignee, and invisible to a colleague who holds `workflows.tasks.view`.
 *
 * Spec `.ai/specs/2026-07-26-workflows-ux-redesign.md` §6.4.
 *
 * Surfaces under test:
 * - GET  /api/workflows/tasks
 * - GET  /api/workflows/tasks/[id]
 * - POST /api/workflows/tasks/[id]/complete
 *
 * This is the headline behaviour change of the release, asserted in BOTH
 * directions because either one alone is a different bug:
 *
 * - The **assignee** holds only `workflows.view` + `workflows.tasks.view` +
 *   `workflows.tasks.complete` — no `view_all`, no `manage`, no wildcard — and
 *   still sees and completes their own work. Losing this is the outage.
 * - The **bystander** holds exactly the same features and no longer sees the
 *   row at all. Keeping this is the narrowing.
 *
 * Two further properties ride along:
 *
 * 1. **The legacy row shape stays visible.** The fixture task carries no entity
 *    bindings, so `entityBindings`/`entityTypes` are null — the shape of every
 *    `UserTask` written before the task inspector existed. The entity clause
 *    passes vacuously for a backoffice principal, which is what keeps the
 *    pre-existing corpus readable by its own assignees on upgrade. If that
 *    inverts, this assertion is the tripwire.
 * 2. **Refusals do not disclose existence.** A real task the caller has no
 *    relationship to and a random uuid return byte-identical bodies with the
 *    same status. (The cross-TENANT case is covered by the unit matrix and by
 *    the `tenantId` in the route's own lookup, which runs before the predicate
 *    and therefore before any write; provisioning a second tenant is out of
 *    reach of the API fixtures used here.)
 */

const BASE_TASK_FEATURES = [
  'workflows.view',
  'workflows.instances.view',
  'workflows.tasks.view',
  'workflows.tasks.complete',
]

const RANDOM_TASK_ID = randomUUID()

test.describe('TC-WF-044: task visibility follows assignment, not the view feature', () => {
  test('the assignee sees and completes their task; a colleague with the same features cannot', async ({ request }) => {
    test.setTimeout(90_000)

    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(adminToken)
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const password = 'StrongSecret123!'
    const tenantOpt = tenantId ? { tenantId } : {}

    let roleId: string | null = null
    let assigneeId: string | null = null
    let bystanderId: string | null = null
    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      roleId = await createRoleFixture(request, superadminToken, {
        name: `qa-tc-wf-044-${stamp}`,
        ...tenantOpt,
      })
      // Deliberately the pre-change grant set: enough to reach the task API and
      // the complete route, and nothing that grants administration.
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: BASE_TASK_FEATURES,
        organizations: null,
      })

      assigneeId = await createUserFixture(request, superadminToken, {
        email: `qa-tc-wf-044-assignee-${stamp}@example.com`,
        password,
        organizationId,
        roles: [roleId],
        name: 'QA TC-WF-044 assignee',
      })
      bystanderId = await createUserFixture(request, superadminToken, {
        email: `qa-tc-wf-044-bystander-${stamp}@example.com`,
        password,
        organizationId,
        roles: [roleId],
        name: 'QA TC-WF-044 bystander',
      })

      const assigneeToken = await getAuthToken(
        request,
        `qa-tc-wf-044-assignee-${stamp}@example.com`,
        password,
      )
      const bystanderToken = await getAuthToken(
        request,
        `qa-tc-wf-044-bystander-${stamp}@example.com`,
        password,
      )

      const definitionPayload = buildAssignedUserTaskDefinitionPayload(Date.now(), assigneeId, '-visibility')
      definitionId = await createWorkflowDefinitionFixture(request, adminToken, definitionPayload)

      instanceId = await startWorkflowInstanceFixture(request, adminToken, {
        workflowId: definitionPayload.workflowId,
        initialContext: { stamp },
      })

      // Fixture read as admin (wildcard grant) — the assignee's own read is what
      // the test asserts, so it must not also be the way the task is found.
      const created = await findInstanceUserTask(request, adminToken, instanceId, { statuses: ['PENDING'] })
      expect(created?.id, 'the USER_TASK step creates a PENDING task').toBeTruthy()
      const taskId = created!.id!
      expect(created?.assignedTo, 'the task is assigned to the fixture user').toBe(assigneeId)

      // --- The bystander holds the task-API feature and is admitted to the route.
      const bystanderList = await apiRequest(
        request,
        'GET',
        `/api/workflows/tasks?workflowInstanceId=${encodeURIComponent(instanceId)}`,
        { token: bystanderToken },
      )
      expect(bystanderList.status(), 'workflows.tasks.view still admits the caller to the list route').toBe(200)
      const bystanderBody = await readJsonSafe<{ data?: UserTaskSnapshot[] }>(bystanderList)
      expect(
        (bystanderBody?.data ?? []).some((task) => task.id === taskId),
        'a colleague with workflows.tasks.view no longer sees somebody else\'s task',
      ).toBe(false)

      // --- Existence is not disclosed: the real row and a random uuid agree.
      const bystanderDetail = await apiRequest(
        request,
        'GET',
        `/api/workflows/tasks/${encodeURIComponent(taskId)}`,
        { token: bystanderToken },
      )
      const bystanderMissing = await apiRequest(
        request,
        'GET',
        `/api/workflows/tasks/${encodeURIComponent(RANDOM_TASK_ID)}`,
        { token: bystanderToken },
      )
      expect(bystanderDetail.status(), 'reading an unrelated task is a 404, not a 403').toBe(404)
      expect(bystanderMissing.status(), 'reading a nonexistent task is a 404').toBe(404)
      const refusedBody = await bystanderDetail.text()
      const missingBody = await bystanderMissing.text()
      expect(
        refusedBody,
        'an existing-but-unrelated task and a nonexistent one must be indistinguishable',
      ).toBe(missingBody)

      const bystanderComplete = await apiRequest(
        request,
        'POST',
        `/api/workflows/tasks/${encodeURIComponent(taskId)}/complete`,
        { token: bystanderToken, data: { formData: { approved: true } } },
      )
      expect(
        bystanderComplete.status(),
        'holding workflows.tasks.complete no longer completes another user\'s task',
      ).toBe(404)

      // --- The assignee holds no administration feature and still owns the row.
      const assigneeList = await apiRequest(
        request,
        'GET',
        `/api/workflows/tasks?workflowInstanceId=${encodeURIComponent(instanceId)}`,
        { token: assigneeToken },
      )
      expect(assigneeList.status(), 'the assignee reaches the list route').toBe(200)
      const assigneeBody = await readJsonSafe<{ data?: UserTaskSnapshot[] }>(assigneeList)
      const listed = (assigneeBody?.data ?? []).find((task) => task.id === taskId)
      expect(listed, 'the assignee sees their own task with no workflows administration grant').toBeTruthy()
      expect(
        listed?.entityBindings ?? null,
        'the fixture row carries no bindings — the legacy shape the entity clause must pass vacuously',
      ).toBeNull()

      const assigneeDetail = await apiRequest(
        request,
        'GET',
        `/api/workflows/tasks/${encodeURIComponent(taskId)}`,
        { token: assigneeToken },
      )
      expect(assigneeDetail.status(), 'the assignee reads their own task detail').toBe(200)

      const assigneeComplete = await apiRequest(
        request,
        'POST',
        `/api/workflows/tasks/${encodeURIComponent(taskId)}/complete`,
        { token: assigneeToken, data: { formData: { approved: true } } },
      )
      expect(assigneeComplete.status(), 'the assignee completes their own task').toBe(200)
      const completed = await readJsonSafe<{ data?: UserTaskSnapshot }>(assigneeComplete)
      expect(completed?.data?.status).toBe('COMPLETED')
      expect(completed?.data?.completedBy).toBe(assigneeId)
    } finally {
      await cancelWorkflowInstanceIfExists(request, adminToken, instanceId)
      await deleteWorkflowDefinitionIfExists(request, adminToken, definitionId)
      await deleteUserIfExists(request, superadminToken, assigneeId)
      await deleteUserIfExists(request, superadminToken, bystanderId)
      await deleteRoleIfExists(request, superadminToken, roleId)
    }
  })
})
