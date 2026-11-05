import { expect, test } from '@playwright/test'
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
 * TC-WF-045 [P0]: `workflows.tasks.view_all` widens seeing, never acting —
 * reassignment is the only supported path from "I can see it" to "I can do it".
 *
 * Spec `.ai/specs/2026-07-26-workflows-ux-redesign.md` §6.4.
 *
 * Surfaces under test:
 * - GET  /api/workflows/tasks/[id]
 * - POST /api/workflows/tasks/[id]/complete
 * - POST /api/workflows/tasks/[id]/reassign
 *
 * The asymmetry is the point. A supervisor holding `view_all` reads a
 * colleague's task, and completing it is refused with `409
 * TASK_ASSIGNED_TO_ANOTHER_USER` — a DIFFERENT answer from the 404 a caller
 * with no relationship gets (TC-WF-044), because a principal who already sees
 * the row in a list learns nothing new from a specific refusal. To act, they
 * take the row through `reassign`, which stamps `reassignedBy` / `reassignedAt`
 * / `reassignReason` so "who approved this, and how did it get to them?" stays
 * answerable afterwards.
 *
 * The mirror assertion matters just as much: once the task has moved, the
 * ORIGINAL assignee — who still holds `workflows.tasks.complete` — is refused
 * with a 404. Reassignment moves the work, it does not share it.
 */

const ASSIGNEE_FEATURES = [
  'workflows.view',
  'workflows.instances.view',
  'workflows.tasks.view',
  'workflows.tasks.complete',
]

const SUPERVISOR_FEATURES = [
  ...ASSIGNEE_FEATURES,
  'workflows.tasks.view_all',
  'workflows.tasks.reassign',
]

test.describe('TC-WF-045: administration sees a colleague\'s task but must reassign to act', () => {
  test('a view_all supervisor reads but cannot complete, then reassigns to self and completes', async ({ request }) => {
    test.setTimeout(90_000)

    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(adminToken)
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const password = 'StrongSecret123!'
    const tenantOpt = tenantId ? { tenantId } : {}

    let assigneeRoleId: string | null = null
    let supervisorRoleId: string | null = null
    let assigneeId: string | null = null
    let supervisorId: string | null = null
    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      assigneeRoleId = await createRoleFixture(request, superadminToken, {
        name: `qa-tc-wf-045-assignee-${stamp}`,
        ...tenantOpt,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: assigneeRoleId,
        features: ASSIGNEE_FEATURES,
        organizations: null,
      })

      supervisorRoleId = await createRoleFixture(request, superadminToken, {
        name: `qa-tc-wf-045-supervisor-${stamp}`,
        ...tenantOpt,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: supervisorRoleId,
        features: SUPERVISOR_FEATURES,
        organizations: null,
      })

      const assigneeEmail = `qa-tc-wf-045-assignee-${stamp}@example.com`
      const supervisorEmail = `qa-tc-wf-045-supervisor-${stamp}@example.com`

      assigneeId = await createUserFixture(request, superadminToken, {
        email: assigneeEmail,
        password,
        organizationId,
        roles: [assigneeRoleId],
        name: 'QA TC-WF-045 assignee',
      })
      supervisorId = await createUserFixture(request, superadminToken, {
        email: supervisorEmail,
        password,
        organizationId,
        roles: [supervisorRoleId],
        name: 'QA TC-WF-045 supervisor',
      })

      const assigneeToken = await getAuthToken(request, assigneeEmail, password)
      const supervisorToken = await getAuthToken(request, supervisorEmail, password)

      const definitionPayload = buildAssignedUserTaskDefinitionPayload(Date.now(), assigneeId, '-admin')
      definitionId = await createWorkflowDefinitionFixture(request, adminToken, definitionPayload)
      instanceId = await startWorkflowInstanceFixture(request, adminToken, {
        workflowId: definitionPayload.workflowId,
        initialContext: { stamp },
      })

      const created = await findInstanceUserTask(request, adminToken, instanceId, { statuses: ['PENDING'] })
      expect(created?.id, 'the USER_TASK step creates a PENDING task').toBeTruthy()
      const taskId = created!.id!

      // --- Seeing is granted.
      const supervisorDetail = await apiRequest(
        request,
        'GET',
        `/api/workflows/tasks/${encodeURIComponent(taskId)}`,
        { token: supervisorToken },
      )
      expect(supervisorDetail.status(), 'workflows.tasks.view_all reads a colleague\'s task').toBe(200)
      const detailBody = await readJsonSafe<{ data?: UserTaskSnapshot }>(supervisorDetail)
      expect(detailBody?.data?.assignedTo, 'the row still belongs to the assignee').toBe(assigneeId)

      // --- Acting is not.
      const refusedComplete = await apiRequest(
        request,
        'POST',
        `/api/workflows/tasks/${encodeURIComponent(taskId)}/complete`,
        { token: supervisorToken, data: { formData: { approved: true } } },
      )
      expect(
        refusedComplete.status(),
        'view_all + complete does not complete somebody else\'s task',
      ).toBe(409)
      const refusedBody = await readJsonSafe<{ code?: string }>(refusedComplete)
      expect(
        refusedBody?.code,
        'a caller who can already see the row gets the specific conflict, not the generic 404',
      ).toBe('TASK_ASSIGNED_TO_ANOTHER_USER')

      // --- Reassignment is the sanctioned path, and it is audited.
      const reassign = await apiRequest(
        request,
        'POST',
        `/api/workflows/tasks/${encodeURIComponent(taskId)}/reassign`,
        {
          token: supervisorToken,
          data: { assignedTo: supervisorId, reason: 'QA TC-WF-045: assignee unavailable' },
        },
      )
      expect(reassign.status(), 'a workflows.tasks.reassign holder may move the task').toBe(200)
      const reassigned = await readJsonSafe<{ data?: UserTaskSnapshot & {
        reassignedBy?: string | null
        reassignedAt?: string | null
        reassignReason?: string | null
      } }>(reassign)
      expect(reassigned?.data?.assignedTo, 'the task now belongs to the supervisor').toBe(supervisorId)
      expect(reassigned?.data?.reassignedBy, 'the mover is recorded').toBe(supervisorId)
      expect(reassigned?.data?.reassignedAt, 'the move is timestamped').toBeTruthy()
      expect(reassigned?.data?.reassignReason, 'the reason is recorded verbatim').toBe(
        'QA TC-WF-045: assignee unavailable',
      )

      // --- The move is a transfer, not a share: the old assignee loses the row.
      const oldAssigneeComplete = await apiRequest(
        request,
        'POST',
        `/api/workflows/tasks/${encodeURIComponent(taskId)}/complete`,
        { token: assigneeToken, data: { formData: { approved: true } } },
      )
      expect(
        oldAssigneeComplete.status(),
        'the previous assignee has no relationship left and is refused as if the row did not exist',
      ).toBe(404)

      // --- And now the supervisor owns it for real.
      const ownedComplete = await apiRequest(
        request,
        'POST',
        `/api/workflows/tasks/${encodeURIComponent(taskId)}/complete`,
        { token: supervisorToken, data: { formData: { approved: true } } },
      )
      expect(ownedComplete.status(), 'after reassignment the supervisor completes it').toBe(200)
      const completedBody = await readJsonSafe<{ data?: UserTaskSnapshot }>(ownedComplete)
      expect(completedBody?.data?.status).toBe('COMPLETED')
      expect(completedBody?.data?.completedBy).toBe(supervisorId)
    } finally {
      await cancelWorkflowInstanceIfExists(request, adminToken, instanceId)
      await deleteWorkflowDefinitionIfExists(request, adminToken, definitionId)
      await deleteUserIfExists(request, superadminToken, assigneeId)
      await deleteUserIfExists(request, superadminToken, supervisorId)
      await deleteRoleIfExists(request, superadminToken, assigneeRoleId)
      await deleteRoleIfExists(request, superadminToken, supervisorRoleId)
    }
  })
})
