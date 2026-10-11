import { expect, test, type Page } from '@playwright/test'
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
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  findInstanceUserTask,
  getUserTaskDetail,
  listWorkInbox,
  pollWorkInbox,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-068 [P1]: tasks bound to a REGISTERED app-owned entity are visible to
 * holders of the registered `view` feature and deep-link to the record.
 *
 * Spec `.ai/specs/2026-10-11-workflows-task-entity-registration.md` (#7180).
 *
 * Surfaces under test:
 * - GET /api/workflows/work-inbox        (`entityBindings[].href`)
 * - GET /api/workflows/tasks/[id]        (`entityBindings[].href`, 404 refusal)
 * - /backend/work-inbox                  (`work-inbox-entity-link`)
 * - /backend/tasks/[id]                  (`task-context-records` card)
 *
 * The registrations come from the test-only `workflows_entity_probe` app module,
 * which registers only under `OM_INTEGRATION_TEST=true`:
 * - `example:todo`          → `example.todos.view`, link `/backend/todos/<id>/edit`
 * - `example:example_item`  → `example.todos.view`, link builder answering an
 *                             off-origin URL the server must drop
 * - `example:example_customer_priority` is NOT registered and must stay
 *   `unavailable` (visible to superadmins only).
 */

const BASE_TASK_FEATURES = [
  'workflows.view',
  'workflows.view_tasks',
  'workflows.instances.view',
  'workflows.tasks.view',
]

const PASSWORD = 'StrongSecret123!'

type BoundTaskDefinitionOptions = {
  stamp: string
  suffix: string
  stepName: string
  entityType: string
  assignedTo: string
}

function buildBoundTaskDefinitionPayload(options: BoundTaskDefinitionOptions) {
  const workflowId = `qa-wf-068-${options.suffix}-${options.stamp}`
  return {
    workflowId,
    workflowName: `QA TC-WF-068 ${options.suffix} ${options.stamp}`,
    description: `Integration test definition ${workflowId}`,
    version: 1,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        {
          stepId: 'review',
          stepName: options.stepName,
          stepType: 'USER_TASK',
          userTaskConfig: {
            assignedTo: options.assignedTo,
            formSchema: { properties: { approved: { type: 'boolean' } } },
            entityBindings: [{ entityType: options.entityType, idPath: 'context.todoId' }],
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

type InboxBinding = { entityType?: string; entityId?: string; href?: string | null }

function bindingsOf(row: { entityBindings?: unknown } | undefined): InboxBinding[] {
  return Array.isArray(row?.entityBindings) ? (row!.entityBindings as InboxBinding[]) : []
}

async function loginAs(page: Page, email: string, password: string): Promise<void> {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
  await page.context().addCookies([
    { name: 'om_demo_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' },
    { name: 'om_cookie_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' },
  ])
  const form = new URLSearchParams()
  form.set('email', email)
  form.set('password', password)
  const response = await page.request.post('/api/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  })
  expect(response.ok(), `browser login for ${email} should succeed, got ${response.status()}`).toBeTruthy()
}

test.describe('TC-WF-068: registered task entity types gate visibility and deep-link to the record', () => {
  test('feature holder sees linked tasks; non-holder, unregistered type and off-origin links fail closed', async ({ page, request }) => {
    test.setTimeout(180_000)

    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(adminToken)
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const tenantOpt = tenantId ? { tenantId } : {}
    const viewerEmail = `qa-tc-wf-068-viewer-${stamp}@example.com`
    const outsiderEmail = `qa-tc-wf-068-outsider-${stamp}@example.com`

    let viewerRoleId: string | null = null
    let outsiderRoleId: string | null = null
    let viewerId: string | null = null
    let outsiderId: string | null = null
    let todoId: string | null = null
    const definitionIds: Array<string | null> = []
    const instanceIds: Array<string | null> = []

    try {
      viewerRoleId = await createRoleFixture(request, superadminToken, { name: `qa-tc-wf-068-viewer-${stamp}`, ...tenantOpt })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: viewerRoleId,
        features: [...BASE_TASK_FEATURES, 'example.todos.view', 'example.todos.manage'],
        organizations: null,
      })
      outsiderRoleId = await createRoleFixture(request, superadminToken, { name: `qa-tc-wf-068-outsider-${stamp}`, ...tenantOpt })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: outsiderRoleId,
        features: BASE_TASK_FEATURES,
        organizations: null,
      })

      viewerId = await createUserFixture(request, superadminToken, {
        email: viewerEmail,
        password: PASSWORD,
        organizationId,
        roles: [viewerRoleId],
        name: 'QA TC-WF-068 viewer',
      })
      outsiderId = await createUserFixture(request, superadminToken, {
        email: outsiderEmail,
        password: PASSWORD,
        organizationId,
        roles: [outsiderRoleId],
        name: 'QA TC-WF-068 outsider',
      })
      const viewerToken = await getAuthToken(request, viewerEmail, PASSWORD)
      const outsiderToken = await getAuthToken(request, outsiderEmail, PASSWORD)

      const todoTitle = `QA TC-WF-068 todo ${stamp}`
      const createdTodo = await apiRequest(request, 'POST', '/api/example/todos', {
        token: adminToken,
        data: { title: todoTitle },
      })
      expect(createdTodo.ok(), `todo fixture should be created, got ${createdTodo.status()}`).toBeTruthy()
      todoId = (await readJsonSafe<{ id?: string }>(createdTodo))?.id ?? null
      expect(todoId, 'the todo fixture has an id').toBeTruthy()
      const todoHref = `/backend/todos/${encodeURIComponent(todoId!)}/edit`

      const scenarios = {
        linked: { suffix: 'linked', stepName: `Linked todo ${stamp}`, entityType: 'example:todo', assignedTo: viewerId },
        outsider: { suffix: 'outsider', stepName: `Outsider todo ${stamp}`, entityType: 'example:todo', assignedTo: outsiderId },
        offOrigin: { suffix: 'off-origin', stepName: `Off-origin item ${stamp}`, entityType: 'example:example_item', assignedTo: viewerId },
        unregistered: {
          suffix: 'unregistered',
          stepName: `Unregistered priority ${stamp}`,
          entityType: 'example:example_customer_priority',
          assignedTo: viewerId,
        },
      } as const

      const taskIds: Record<keyof typeof scenarios, string> = { linked: '', outsider: '', offOrigin: '', unregistered: '' }
      const instanceByScenario: Record<keyof typeof scenarios, string> = { linked: '', outsider: '', offOrigin: '', unregistered: '' }
      for (const key of Object.keys(scenarios) as Array<keyof typeof scenarios>) {
        const payload = buildBoundTaskDefinitionPayload({ stamp, ...scenarios[key] })
        const definitionId = await createWorkflowDefinitionFixture(request, adminToken, payload)
        definitionIds.push(definitionId)
        const instanceId = await startWorkflowInstanceFixture(request, adminToken, {
          workflowId: payload.workflowId,
          initialContext: { todoId },
        })
        instanceIds.push(instanceId)
        instanceByScenario[key] = instanceId
        const task = await findInstanceUserTask(request, superadminToken, instanceId, { statuses: ['PENDING'] })
        expect(task?.id, `the ${key} USER_TASK step creates a PENDING task`).toBeTruthy()
        taskIds[key] = task!.id!
      }

      // --- Registered type + feature holder: visible, with a same-origin href.
      const viewerInbox = await pollWorkInbox(
        request,
        viewerToken,
        `?workflowInstanceId=${encodeURIComponent(instanceByScenario.linked)}`,
        (body) => (body.data ?? []).some((row) => row.id === taskIds.linked),
      )
      const linkedRow = (viewerInbox?.data ?? []).find((row) => row.id === taskIds.linked)
      expect(linkedRow, 'the feature holder sees the task bound to the registered type').toBeTruthy()
      expect(bindingsOf(linkedRow)).toEqual([
        expect.objectContaining({ entityType: 'example:todo', entityId: todoId, href: todoHref }),
      ])

      const linkedDetail = await getUserTaskDetail(request, viewerToken, taskIds.linked)
      expect(linkedDetail, 'the feature holder reads the task detail').toBeTruthy()
      expect(bindingsOf(linkedDetail ?? undefined)).toEqual([
        expect.objectContaining({ entityType: 'example:todo', entityId: todoId, href: todoHref }),
      ])

      // --- Off-origin link builder: the task stays visible, the link is dropped.
      const offOriginInbox = await pollWorkInbox(
        request,
        viewerToken,
        `?workflowInstanceId=${encodeURIComponent(instanceByScenario.offOrigin)}`,
        (body) => (body.data ?? []).some((row) => row.id === taskIds.offOrigin),
      )
      const offOriginRow = (offOriginInbox?.data ?? []).find((row) => row.id === taskIds.offOrigin)
      expect(offOriginRow, 'a registered view requirement still makes the task visible').toBeTruthy()
      const offOriginBindings = bindingsOf(offOriginRow)
      expect(offOriginBindings).toHaveLength(1)
      expect(offOriginBindings[0]?.href ?? null, 'an off-origin href is never served').toBeNull()
      const offOriginDetail = await getUserTaskDetail(request, viewerToken, taskIds.offOrigin)
      expect(bindingsOf(offOriginDetail ?? undefined)[0]?.href ?? null, 'the detail drops it too').toBeNull()

      // --- Unregistered app-owned type: hidden from a non-superadmin, even its assignee.
      const unregisteredInbox = await listWorkInbox(
        request,
        viewerToken,
        `?workflowInstanceId=${encodeURIComponent(instanceByScenario.unregistered)}`,
      )
      expect(
        (unregisteredInbox?.data ?? []).some((row) => row.id === taskIds.unregistered),
        'a task bound to an unregistered app type stays unavailable',
      ).toBe(false)
      const unregisteredDetail = await apiRequest(
        request,
        'GET',
        `/api/workflows/tasks/${encodeURIComponent(taskIds.unregistered)}`,
        { token: viewerToken },
      )
      expect(unregisteredDetail.status(), 'the unregistered-type task detail is a 404').toBe(404)

      // --- Registered type, caller without the view feature: no row, bare 404.
      const outsiderInbox = await listWorkInbox(
        request,
        outsiderToken,
        `?workflowInstanceId=${encodeURIComponent(instanceByScenario.outsider)}`,
      )
      expect(
        (outsiderInbox?.data ?? []).some((row) => row.id === taskIds.outsider),
        'the assignee without example.todos.view does not see the task',
      ).toBe(false)
      const outsiderDetail = await apiRequest(
        request,
        'GET',
        `/api/workflows/tasks/${encodeURIComponent(taskIds.outsider)}`,
        { token: outsiderToken },
      )
      expect(outsiderDetail.status(), 'the refused detail is a 404').toBe(404)
      const outsiderBody = await outsiderDetail.text()
      expect(outsiderBody, 'the refusal does not disclose the binding').not.toContain('example:todo')
      expect(outsiderBody).not.toContain(todoId!)

      // --- UI: the inbox row and the task detail both link to the record.
      await loginAs(page, viewerEmail, PASSWORD)
      await page.goto('/backend/work-inbox', { waitUntil: 'domcontentloaded' })
      const inboxLink = page.locator(`[data-testid="work-inbox-entity-link"][href="${todoHref}"]`)
      await expect(inboxLink, 'the inbox row renders the registered deep link').toBeVisible({ timeout: 30_000 })
      await expect(page.getByText(scenarios.unregistered.stepName)).toHaveCount(0)
      await inboxLink.click()
      await expect(page).toHaveURL(new RegExp(`/backend/todos/${todoId}/edit$`))
      await expect(page.locator('[data-crud-field-id="title"] input').first()).toHaveValue(todoTitle)

      await page.goto(`/backend/tasks/${encodeURIComponent(taskIds.linked)}`, { waitUntil: 'domcontentloaded' })
      const contextCard = page.getByTestId('task-context-records')
      await expect(contextCard.locator(`a[href="${todoHref}"]`), 'the "About what" card links to the record').toBeVisible({
        timeout: 30_000,
      })

      await page.goto(`/backend/tasks/${encodeURIComponent(taskIds.offOrigin)}`, { waitUntil: 'domcontentloaded' })
      const offOriginCard = page.getByTestId('task-context-records')
      await expect(offOriginCard.getByText('example:example_item').first()).toBeVisible({ timeout: 30_000 })
      await expect(offOriginCard.locator('a'), 'no link is rendered for the off-origin builder').toHaveCount(0)

      await page.context().clearCookies()
      await loginAs(page, outsiderEmail, PASSWORD)
      await page.goto(`/backend/tasks/${encodeURIComponent(taskIds.outsider)}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByText('Task not found').first()).toBeVisible({ timeout: 30_000 })
    } finally {
      for (const instanceId of instanceIds) {
        await cancelWorkflowInstanceIfExists(request, adminToken, instanceId)
      }
      for (const definitionId of definitionIds) {
        await deleteWorkflowDefinitionIfExists(request, adminToken, definitionId)
      }
      await deleteEntityIfExists(request, adminToken, '/api/example/todos', todoId)
      await deleteUserIfExists(request, superadminToken, viewerId)
      await deleteUserIfExists(request, superadminToken, outsiderId)
      await deleteRoleIfExists(request, superadminToken, viewerRoleId)
      await deleteRoleIfExists(request, superadminToken, outsiderRoleId)
    }
  })
})
