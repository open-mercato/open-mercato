import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomInt } from 'node:crypto'
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
 * TC-WF-046 [P0]: the tenant opt-out restores the legacy READ filter and nothing
 * else — acting stays narrowed.
 *
 * Spec `.ai/specs/2026-07-26-workflows-ux-redesign.md` §6.4; the flag is the
 * one-minor bridge that discharges `BACKWARD_COMPATIBILITY.md`'s "keep the old
 * behaviour alongside the new one" protocol step for this security-semantics
 * change.
 *
 * Surfaces under test:
 * - GET  /api/workflows/task-settings
 * - PUT  /api/workflows/task-settings
 * - GET  /api/workflows/tasks/[id]
 * - POST /api/workflows/tasks/[id]/complete
 *
 * The whole risk of shipping an escape hatch is that it becomes a second
 * authorization model. It is not one: `businessContextEnabled` is a `SELECT`
 * filter. With the flag off, the bystander from TC-WF-044 gets the row back —
 * and completing it is still refused, because `actable` is computed by the new
 * rule whether the flag is on or off. Both halves are asserted here; asserting
 * only the restored read would let a regression that also reopened the act path
 * pass.
 *
 * The setting is TENANT-scoped and this spec mutates it, so the restore runs in
 * `finally` and the round trip back to `true` is asserted inside the test. The
 * repo's Playwright config runs with `workers: 1`, so no concurrent spec can
 * observe the window.
 */

const TASK_FEATURES = [
  'workflows.view',
  'workflows.instances.view',
  'workflows.tasks.view',
  'workflows.tasks.complete',
]

type SettingsBody = { taskPermissionsBusinessContext?: boolean }

async function setBusinessContext(
  request: APIRequestContext,
  token: string,
  enabled: boolean,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', '/api/workflows/task-settings', {
    token,
    data: { taskPermissionsBusinessContext: enabled },
  })
  expect(response.status(), `PUT task-settings ${enabled} should return 200`).toBe(200)
}

test.describe('TC-WF-046: the task-permission opt-out restores reads only', () => {
  test('flipping the tenant flag off returns the row and still refuses a foreign complete', async ({ request }) => {
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
    let flagFlipped = false

    try {
      // The default is ON — the new model — and it is read from the tenant
      // setting, not hardcoded, so assert it before changing anything.
      const initial = await apiRequest(request, 'GET', '/api/workflows/task-settings', { token: adminToken })
      expect(initial.status(), 'reading the setting needs workflows.tasks.view_all').toBe(200)
      const initialBody = await readJsonSafe<SettingsBody>(initial)
      expect(
        initialBody?.taskPermissionsBusinessContext,
        'the business-context model is ON by default',
      ).toBe(true)

      roleId = await createRoleFixture(request, superadminToken, {
        name: `qa-tc-wf-046-${stamp}`,
        ...tenantOpt,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: TASK_FEATURES,
        organizations: null,
      })

      const assigneeEmail = `qa-tc-wf-046-assignee-${stamp}@example.com`
      const bystanderEmail = `qa-tc-wf-046-bystander-${stamp}@example.com`

      assigneeId = await createUserFixture(request, superadminToken, {
        email: assigneeEmail,
        password,
        organizationId,
        roles: [roleId],
        name: 'QA TC-WF-046 assignee',
      })
      bystanderId = await createUserFixture(request, superadminToken, {
        email: bystanderEmail,
        password,
        organizationId,
        roles: [roleId],
        name: 'QA TC-WF-046 bystander',
      })
      const bystanderToken = await getAuthToken(request, bystanderEmail, password)

      const definitionPayload = buildAssignedUserTaskDefinitionPayload(Date.now(), assigneeId, '-optout')
      definitionId = await createWorkflowDefinitionFixture(request, adminToken, definitionPayload)
      instanceId = await startWorkflowInstanceFixture(request, adminToken, {
        workflowId: definitionPayload.workflowId,
        initialContext: { stamp },
      })

      const created = await findInstanceUserTask(request, adminToken, instanceId, { statuses: ['PENDING'] })
      expect(created?.id, 'the USER_TASK step creates a PENDING task').toBeTruthy()
      const taskId = created!.id!
      const detailPath = `/api/workflows/tasks/${encodeURIComponent(taskId)}`

      // --- Flag ON: the bystander cannot see the row.
      const hidden = await apiRequest(request, 'GET', detailPath, { token: bystanderToken })
      expect(hidden.status(), 'with the new model on, an unrelated caller gets a 404').toBe(404)

      // --- Flag OFF: the legacy read filter comes back.
      await setBusinessContext(request, adminToken, false)
      flagFlipped = true

      const restored = await apiRequest(request, 'GET', detailPath, { token: bystanderToken })
      expect(restored.status(), 'the opt-out restores the pre-change read for workflows.tasks.view').toBe(200)

      const restoredList = await apiRequest(
        request,
        'GET',
        `/api/workflows/tasks?workflowInstanceId=${encodeURIComponent(instanceId)}`,
        { token: bystanderToken },
      )
      expect(restoredList.status()).toBe(200)
      const restoredListBody = await readJsonSafe<{ data?: UserTaskSnapshot[] }>(restoredList)
      expect(
        (restoredListBody?.data ?? []).some((task) => task.id === taskId),
        'the list surface is restored too, not just the detail',
      ).toBe(true)

      // --- …and the act path is untouched by it.
      const stillRefused = await apiRequest(request, 'POST', `${detailPath}/complete`, {
        token: bystanderToken,
        data: { formData: { approved: true } },
      })
      expect(
        stillRefused.status(),
        'the opt-out is a SELECT filter: completing somebody else\'s task is still refused',
      ).toBe(409)
      const refusedBody = await readJsonSafe<{ code?: string }>(stillRefused)
      expect(refusedBody?.code).toBe('TASK_ASSIGNED_TO_ANOTHER_USER')

      // --- Flag back ON: the narrowing returns immediately.
      await setBusinessContext(request, adminToken, true)
      flagFlipped = false

      const hiddenAgain = await apiRequest(request, 'GET', detailPath, { token: bystanderToken })
      expect(hiddenAgain.status(), 'restoring the flag re-narrows the read with no restart').toBe(404)
    } finally {
      if (flagFlipped) {
        await apiRequest(request, 'PUT', '/api/workflows/task-settings', {
          token: adminToken,
          data: { taskPermissionsBusinessContext: true },
        }).catch(() => undefined)
      }
      await cancelWorkflowInstanceIfExists(request, adminToken, instanceId)
      await deleteWorkflowDefinitionIfExists(request, adminToken, definitionId)
      await deleteUserIfExists(request, superadminToken, assigneeId)
      await deleteUserIfExists(request, superadminToken, bystanderId)
      await deleteRoleIfExists(request, superadminToken, roleId)
    }
  })
})
