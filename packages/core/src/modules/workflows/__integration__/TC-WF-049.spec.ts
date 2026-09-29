import { expect, test } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCustomerCompanyFixture,
  createCustomerRoleFixture,
  createCustomerUserFixture,
  deleteCustomerCompanyFixture,
  deleteCustomerRoleFixture,
  deleteCustomerUserFixture,
  portalCookieHeaders,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import {
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  findInstanceUserTask,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-049 [P0]: a portal admin's wildcard buys reading, never owning — and it
 * stops at their own company.
 *
 * Spec `.ai/specs/2026-07-26-workflows-ux-redesign.md` §6.4 (portal principals).
 *
 * Surfaces under test:
 * - GET  /api/workflows/portal/tasks
 * - GET  /api/workflows/portal/tasks/[id]
 * - POST /api/workflows/portal/tasks/[id]/complete
 *
 * `CustomerRbacService.userHasAllFeatures` returns `true` for **every** feature
 * when the caller's role carries `isPortalAdmin` — it short-circuits before any
 * matching. A naive implementation that asked "does this principal hold the
 * feature?" would therefore have handed a portal admin every task in the
 * organization, across customers. The portal branch of the predicate carries no
 * feature array at all: ownership is a `Set.has` against the principal's own
 * record ids, and `isPortalAdmin` is consulted last and only to widen `visible`.
 *
 * Three assertions pin that, in increasing order of severity:
 *
 * 1. The admin **reads** a company member's task and `canComplete` is `false`;
 *    completing it is refused.
 * 2. A same-company **non-admin** peer cannot read their colleague's task at
 *    all, even though the binding names a company record they also "own" —
 *    ownership of the bound record is necessary, not sufficient.
 * 3. The admin cannot read another COMPANY's task, which is the case the
 *    wildcard would have broken.
 */

const PORTAL_TASK_FEATURES = ['portal.tasks.view', 'portal.tasks.complete']

function buildPortalUserTaskDefinitionPayload(timestamp: number, suffix: string) {
  const id = `qa-wf-portal-admin${suffix}-${timestamp}`
  return {
    workflowId: id,
    workflowName: `QA Portal Admin Task${suffix} ${timestamp}`,
    description: `Integration test definition ${id}`,
    version: 1,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        {
          stepId: 'review',
          stepName: 'Review',
          stepType: 'USER_TASK',
          userTaskConfig: {
            assigneeKind: 'customer',
            assignedTo: '{{context.portalUserId}}',
            entityBindings: [{ entityType: 'customers:company', idPath: 'context.companyId' }],
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

type PortalTaskListBody = { ok?: boolean; tasks?: Array<{ id?: string }> }

test.describe('TC-WF-049: a portal admin reads company work but owns none of it', () => {
  test('sees a member\'s task without canComplete, is refused on complete, and never crosses companies', async ({ request }) => {
    test.setTimeout(120_000)

    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`

    let companyA: string | null = null
    let companyB: string | null = null
    let memberRoleId: string | null = null
    let adminRoleId: string | null = null
    let assigneeId: string | null = null
    let peerId: string | null = null
    let portalAdminId: string | null = null
    let foreignId: string | null = null
    let definitionAId: string | null = null
    let definitionBId: string | null = null
    let instanceAId: string | null = null
    let instanceBId: string | null = null

    try {
      companyA = await createCustomerCompanyFixture(request, adminToken, `QA WF-049 A ${stamp}`)
      companyB = await createCustomerCompanyFixture(request, adminToken, `QA WF-049 B ${stamp}`)

      const memberRole = await createCustomerRoleFixture(request, adminToken, {
        features: PORTAL_TASK_FEATURES,
      })
      memberRoleId = memberRole.id
      // No features at all — `isPortalAdmin` alone must admit them to the routes,
      // which is precisely the wildcard this test exists to neutralize.
      const adminRole = await createCustomerRoleFixture(request, adminToken, {
        features: [],
        isPortalAdmin: true,
      })
      adminRoleId = adminRole.id

      const assignee = await createCustomerUserFixture(request, adminToken, {
        roleIds: [memberRole.id],
        customerEntityId: companyA,
      })
      assigneeId = assignee.id
      const peer = await createCustomerUserFixture(request, adminToken, {
        roleIds: [memberRole.id],
        customerEntityId: companyA,
      })
      peerId = peer.id
      const portalAdmin = await createCustomerUserFixture(request, adminToken, {
        roleIds: [adminRole.id],
        customerEntityId: companyA,
      })
      portalAdminId = portalAdmin.id
      const foreign = await createCustomerUserFixture(request, adminToken, {
        roleIds: [memberRole.id],
        customerEntityId: companyB,
      })
      foreignId = foreign.id

      const assigneeSession = await portalLogin(request, {
        email: assignee.email,
        password: assignee.password,
        tenantId,
      })
      const peerSession = await portalLogin(request, {
        email: peer.email,
        password: peer.password,
        tenantId,
      })
      const adminSession = await portalLogin(request, {
        email: portalAdmin.email,
        password: portalAdmin.password,
        tenantId,
      })

      const payloadA = buildPortalUserTaskDefinitionPayload(Date.now(), '-a')
      definitionAId = await createWorkflowDefinitionFixture(request, adminToken, payloadA)
      instanceAId = await startWorkflowInstanceFixture(request, adminToken, {
        workflowId: payloadA.workflowId,
        initialContext: { portalUserId: assignee.id, companyId: companyA },
      })
      const taskA = await findInstanceUserTask(request, adminToken, instanceAId, { statuses: ['PENDING'] })
      expect(taskA?.id, 'company A task is created').toBeTruthy()
      const taskAId = taskA!.id!

      const payloadB = buildPortalUserTaskDefinitionPayload(Date.now(), '-b')
      definitionBId = await createWorkflowDefinitionFixture(request, adminToken, payloadB)
      instanceBId = await startWorkflowInstanceFixture(request, adminToken, {
        workflowId: payloadB.workflowId,
        initialContext: { portalUserId: foreign.id, companyId: companyB },
      })
      const taskB = await findInstanceUserTask(request, adminToken, instanceBId, { statuses: ['PENDING'] })
      expect(taskB?.id, 'company B task is created').toBeTruthy()
      const taskBId = taskB!.id!

      // 1. The admin reads a member's work but cannot finish it.
      const adminList = await request.get('/api/workflows/portal/tasks', {
        headers: portalCookieHeaders(adminSession),
      })
      expect(
        adminList.status(),
        'isPortalAdmin alone admits the caller to the route — no explicit portal.tasks.view',
      ).toBe(200)
      const adminListBody = await readJsonSafe<PortalTaskListBody>(adminList)
      expect(
        (adminListBody?.tasks ?? []).some((task) => task.id === taskAId),
        'a portal admin sees their company members\' tasks',
      ).toBe(true)
      expect(
        (adminListBody?.tasks ?? []).some((task) => task.id === taskBId),
        'and never another company\'s',
      ).toBe(false)

      const adminDetail = await request.get(`/api/workflows/portal/tasks/${encodeURIComponent(taskAId)}`, {
        headers: portalCookieHeaders(adminSession),
      })
      expect(adminDetail.status(), 'the admin reads the member task detail').toBe(200)
      const adminDetailBody = await readJsonSafe<{ canComplete?: boolean }>(adminDetail)
      expect(adminDetailBody?.canComplete, 'reading is not acting').toBe(false)

      const adminComplete = await request.post(
        `/api/workflows/portal/tasks/${encodeURIComponent(taskAId)}/complete`,
        {
          headers: { ...portalCookieHeaders(adminSession), 'Content-Type': 'application/json' },
          data: { formData: { approved: true } },
        },
      )
      expect(
        adminComplete.status(),
        'a portal admin may not complete a member\'s task, and the refusal discloses nothing extra',
      ).toBe(404)

      // 2. A same-company peer owns the bound record and still gets nothing.
      const peerDetail = await request.get(`/api/workflows/portal/tasks/${encodeURIComponent(taskAId)}`, {
        headers: portalCookieHeaders(peerSession),
      })
      expect(
        peerDetail.status(),
        'owning the bound company record is necessary, not sufficient — assignment still decides',
      ).toBe(404)

      // 3. The wildcard stops at the company boundary.
      const adminForeignDetail = await request.get(
        `/api/workflows/portal/tasks/${encodeURIComponent(taskBId)}`,
        { headers: portalCookieHeaders(adminSession) },
      )
      const adminMissing = await request.get(
        '/api/workflows/portal/tasks/00000000-0000-4000-8000-000000000000',
        { headers: portalCookieHeaders(adminSession) },
      )
      expect(adminForeignDetail.status(), 'another company\'s task is a 404 for a portal admin').toBe(404)
      expect(
        await adminForeignDetail.text(),
        'the cross-company refusal is byte-identical to a nonexistent id',
      ).toBe(await adminMissing.text())

      // Control: the actual assignee is unaffected by all of the above.
      const assigneeDetail = await request.get(
        `/api/workflows/portal/tasks/${encodeURIComponent(taskAId)}`,
        { headers: portalCookieHeaders(assigneeSession) },
      )
      expect(assigneeDetail.status(), 'the assignee still reads their own task').toBe(200)
      const assigneeDetailBody = await readJsonSafe<{ canComplete?: boolean }>(assigneeDetail)
      expect(assigneeDetailBody?.canComplete, 'and may still complete it').toBe(true)
    } finally {
      await cancelWorkflowInstanceIfExists(request, adminToken, instanceAId)
      await cancelWorkflowInstanceIfExists(request, adminToken, instanceBId)
      await deleteWorkflowDefinitionIfExists(request, adminToken, definitionAId)
      await deleteWorkflowDefinitionIfExists(request, adminToken, definitionBId)
      await deleteCustomerUserFixture(request, adminToken, assigneeId)
      await deleteCustomerUserFixture(request, adminToken, peerId)
      await deleteCustomerUserFixture(request, adminToken, portalAdminId)
      await deleteCustomerUserFixture(request, adminToken, foreignId)
      await deleteCustomerRoleFixture(request, adminToken, memberRoleId)
      await deleteCustomerRoleFixture(request, adminToken, adminRoleId)
      await deleteCustomerCompanyFixture(request, adminToken, companyA)
      await deleteCustomerCompanyFixture(request, adminToken, companyB)
    }
  })
})
