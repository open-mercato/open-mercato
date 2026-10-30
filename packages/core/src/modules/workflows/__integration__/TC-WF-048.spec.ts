import { expect, test } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
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
 * TC-WF-048 [P0]: a portal principal sees and completes the task bound to their
 * own record — and nothing else.
 *
 * Spec `.ai/specs/2026-07-26-workflows-ux-redesign.md` §6.4 (portal principals).
 *
 * Surfaces under test:
 * - GET  /api/workflows/portal/tasks
 * - GET  /api/workflows/portal/tasks/[id]
 * - POST /api/workflows/portal/tasks/[id]/complete
 * - GET  /api/workflows/tasks/[id]            (must refuse a portal token)
 *
 * The portal branch of the predicate is the mirror image of the backoffice one,
 * and the difference is the whole security story:
 *
 * - A backoffice principal already holds an org-membership grant, so a task with
 *   **no bindings** passes the entity clause vacuously. A portal principal holds
 *   no such grant, so the binding to their own record **is** the authorization —
 *   an unbound task is visible to nobody. Asserted here with a second definition
 *   that authors no bindings at all.
 * - Ownership is a `Set.has` against the principal's own record ids, never a
 *   feature check, so it cannot be satisfied by a wildcard grant (see TC-WF-049
 *   for the portal-admin case).
 *
 * Cross-customer isolation is asserted from the other customer's session rather
 * than inferred: a second company, a second portal user, and the same refusal
 * body a nonexistent id produces.
 *
 * `assigneeKind: 'customer'` is currently authorable only through the Studio's
 * Code view (the definition JSON) — there is no picker yet — which is exactly
 * how this fixture writes it.
 */

const PORTAL_TASK_FEATURES = ['portal.tasks.view', 'portal.tasks.complete']

function buildPortalUserTaskDefinitionPayload(
  timestamp: number,
  options: { bound: boolean; suffix: string },
) {
  const id = `qa-wf-portal${options.suffix}-${timestamp}`
  return {
    workflowId: id,
    workflowName: `QA Portal User Task${options.suffix} ${timestamp}`,
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
            // The portal namespace: `assignedTo` resolves to a CustomerUser id.
            assigneeKind: 'customer',
            assignedTo: '{{context.portalUserId}}',
            ...(options.bound
              ? {
                  entityBindings: [
                    { entityType: 'customers:company', idPath: 'context.companyId' },
                  ],
                }
              : {}),
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

type PortalTaskListBody = { ok?: boolean; tasks?: Array<{ id?: string; assigneeKind?: string }> }

test.describe('TC-WF-048: portal task ownership', () => {
  test('the bound assignee completes it; another customer and an unbound task see nothing', async ({ request }) => {
    test.setTimeout(120_000)

    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`

    let companyA: string | null = null
    let companyB: string | null = null
    let roleId: string | null = null
    let portalUserAId: string | null = null
    let portalUserBId: string | null = null
    let boundDefinitionId: string | null = null
    let unboundDefinitionId: string | null = null
    let boundInstanceId: string | null = null
    let unboundInstanceId: string | null = null

    try {
      companyA = await createCustomerCompanyFixture(request, adminToken, `QA WF-048 A ${stamp}`)
      companyB = await createCustomerCompanyFixture(request, adminToken, `QA WF-048 B ${stamp}`)

      const role = await createCustomerRoleFixture(request, adminToken, {
        features: PORTAL_TASK_FEATURES,
      })
      roleId = role.id

      const portalUserA = await createCustomerUserFixture(request, adminToken, {
        roleIds: [role.id],
        customerEntityId: companyA,
      })
      portalUserAId = portalUserA.id
      const portalUserB = await createCustomerUserFixture(request, adminToken, {
        roleIds: [role.id],
        customerEntityId: companyB,
      })
      portalUserBId = portalUserB.id

      const sessionA = await portalLogin(request, {
        email: portalUserA.email,
        password: portalUserA.password,
        tenantId,
      })
      const sessionB = await portalLogin(request, {
        email: portalUserB.email,
        password: portalUserB.password,
        tenantId,
      })

      // --- A task bound to company A, addressed to portal user A.
      const boundPayload = buildPortalUserTaskDefinitionPayload(Date.now(), { bound: true, suffix: '-bound' })
      boundDefinitionId = await createWorkflowDefinitionFixture(request, adminToken, boundPayload)
      boundInstanceId = await startWorkflowInstanceFixture(request, adminToken, {
        workflowId: boundPayload.workflowId,
        initialContext: { portalUserId: portalUserA.id, companyId: companyA },
      })

      const boundTask = await findInstanceUserTask(request, adminToken, boundInstanceId, { statuses: ['PENDING'] })
      expect(boundTask?.id, 'the portal USER_TASK step creates a PENDING task').toBeTruthy()
      const boundTaskId = boundTask!.id!
      expect(
        (boundTask as { assigneeKind?: string } | null)?.assigneeKind,
        'an authored assigneeKind=customer lands on the row as the discriminator',
      ).toBe('customer')
      expect(boundTask?.assignedTo, 'the assignee is the portal principal id').toBe(portalUserA.id)

      // --- The owner sees it.
      const listA = await request.get('/api/workflows/portal/tasks', {
        headers: portalCookieHeaders(sessionA),
      })
      expect(listA.status(), 'a portal principal with portal.tasks.view reaches the list').toBe(200)
      const listABody = await readJsonSafe<PortalTaskListBody>(listA)
      expect(
        (listABody?.tasks ?? []).some((task) => task.id === boundTaskId),
        'the portal principal sees the task bound to their own company record',
      ).toBe(true)

      const detailA = await request.get(`/api/workflows/portal/tasks/${encodeURIComponent(boundTaskId)}`, {
        headers: portalCookieHeaders(sessionA),
      })
      expect(detailA.status(), 'the owner reads the detail').toBe(200)
      const detailABody = await readJsonSafe<{ canComplete?: boolean }>(detailA)
      expect(detailABody?.canComplete, 'the owner may complete it').toBe(true)

      // --- Another customer sees nothing, and cannot tell it exists.
      const listB = await request.get('/api/workflows/portal/tasks', {
        headers: portalCookieHeaders(sessionB),
      })
      expect(listB.status()).toBe(200)
      const listBBody = await readJsonSafe<PortalTaskListBody>(listB)
      expect(
        (listBBody?.tasks ?? []).some((task) => task.id === boundTaskId),
        'a portal principal from another company never sees the task',
      ).toBe(false)

      const detailB = await request.get(`/api/workflows/portal/tasks/${encodeURIComponent(boundTaskId)}`, {
        headers: portalCookieHeaders(sessionB),
      })
      const missingB = await request.get(
        '/api/workflows/portal/tasks/00000000-0000-4000-8000-000000000000',
        { headers: portalCookieHeaders(sessionB) },
      )
      expect(detailB.status(), 'another customer gets a 404, never a 403').toBe(404)
      expect(await detailB.text(), 'the refusal is byte-identical to a nonexistent id').toBe(
        await missingB.text(),
      )

      // --- The two route trees do not admit each other's principals.
      const portalTokenOnBackoffice = await request.get(
        `/api/workflows/tasks/${encodeURIComponent(boundTaskId)}`,
        { headers: portalCookieHeaders(sessionA) },
      )
      expect(
        portalTokenOnBackoffice.status(),
        'a portal session is not a backoffice session — the backoffice routes were not loosened',
      ).toBe(401)

      const backofficeTokenOnPortal = await apiRequest(request, 'GET', '/api/workflows/portal/tasks', {
        token: adminToken,
      })
      expect(
        backofficeTokenOnPortal.status(),
        'a backoffice bearer token is not a portal session either',
      ).toBe(401)

      // --- An UNBOUND portal task is visible to nobody, its assignee included.
      const unboundPayload = buildPortalUserTaskDefinitionPayload(Date.now(), {
        bound: false,
        suffix: '-unbound',
      })
      unboundDefinitionId = await createWorkflowDefinitionFixture(request, adminToken, unboundPayload)
      unboundInstanceId = await startWorkflowInstanceFixture(request, adminToken, {
        workflowId: unboundPayload.workflowId,
        initialContext: { portalUserId: portalUserA.id },
      })
      const unboundTask = await findInstanceUserTask(request, adminToken, unboundInstanceId, {
        statuses: ['PENDING'],
      })
      expect(unboundTask?.id, 'the unbound portal task exists in the database').toBeTruthy()
      const unboundTaskId = unboundTask!.id!

      const unboundDetail = await request.get(
        `/api/workflows/portal/tasks/${encodeURIComponent(unboundTaskId)}`,
        { headers: portalCookieHeaders(sessionA) },
      )
      expect(
        unboundDetail.status(),
        'with no binding there is nothing to authorize against — even for the assignee',
      ).toBe(404)

      const listAfterUnbound = await request.get('/api/workflows/portal/tasks', {
        headers: portalCookieHeaders(sessionA),
      })
      const listAfterUnboundBody = await readJsonSafe<PortalTaskListBody>(listAfterUnbound)
      expect(
        (listAfterUnboundBody?.tasks ?? []).some((task) => task.id === unboundTaskId),
        'the unbound row is excluded in SQL so pagination.total stays honest',
      ).toBe(false)

      // --- And the owner finishes their own work.
      const complete = await request.post(
        `/api/workflows/portal/tasks/${encodeURIComponent(boundTaskId)}/complete`,
        {
          headers: { ...portalCookieHeaders(sessionA), 'Content-Type': 'application/json' },
          data: { formData: { approved: true } },
        },
      )
      expect(complete.status(), 'the portal assignee completes their own bound task').toBe(200)
      const completeBody = await readJsonSafe<{ ok?: boolean; task?: { status?: string; completedBy?: string } }>(complete)
      expect(completeBody?.ok).toBe(true)
      expect(completeBody?.task?.status).toBe('COMPLETED')
      expect(completeBody?.task?.completedBy).toBe(portalUserA.id)
    } finally {
      await cancelWorkflowInstanceIfExists(request, adminToken, boundInstanceId)
      await cancelWorkflowInstanceIfExists(request, adminToken, unboundInstanceId)
      await deleteWorkflowDefinitionIfExists(request, adminToken, boundDefinitionId)
      await deleteWorkflowDefinitionIfExists(request, adminToken, unboundDefinitionId)
      await deleteCustomerUserFixture(request, adminToken, portalUserAId)
      await deleteCustomerUserFixture(request, adminToken, portalUserBId)
      await deleteCustomerRoleFixture(request, adminToken, roleId)
      await deleteCustomerCompanyFixture(request, adminToken, companyA)
      await deleteCustomerCompanyFixture(request, adminToken, companyB)
    }
  })
})
