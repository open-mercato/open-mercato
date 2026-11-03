import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { acknowledgeGlobalNotices } from '@open-mercato/core/helpers/integration/auth'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { deleteAttachmentIfExists } from '@open-mercato/core/helpers/integration/attachmentsFixtures'
import {
  createCustomerCompanyFixture,
  createCustomerRoleFixture,
  createCustomerUserFixture,
  deleteCustomerCompanyFixture,
  deleteCustomerRoleFixture,
  deleteCustomerUserFixture,
  portalCookieHeaders,
  portalLogin,
  uniqueSuffix,
  type PortalSession,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createTestTimeProject, type TestTimeProjectFixture } from '../fixtures'

export const SUPPORT_CATEGORY_DICTIONARY_KEY = 'staff.support_ticket_category'
export const PORTAL_VIEW = 'portal.support_tickets.view'
export const PORTAL_MANAGE = 'portal.support_tickets.manage'

/** Collects cleanup steps and runs them in reverse, swallowing errors, so a spec's `finally` is one line. */
export class Cleanup {
  private readonly steps: Array<() => Promise<unknown>> = []

  add(step: () => Promise<unknown>): void {
    this.steps.push(step)
  }

  async run(): Promise<void> {
    for (const step of this.steps.reverse()) {
      await step().catch(() => undefined)
    }
    this.steps.length = 0
  }
}

export async function adminToken(request: APIRequestContext): Promise<string> {
  return getAuthToken(request, 'admin')
}

async function okJson<T>(response: Awaited<ReturnType<typeof apiRequest>>, label: string): Promise<T> {
  const body = await readJsonSafe<T>(response)
  expect(response.ok(), `${label} failed with ${response.status()}: ${JSON.stringify(body)}`).toBeTruthy()
  return body as T
}

// ---------------------------------------------------------------- staff people

export type StaffPerson = {
  userId: string
  email: string
  password: string
  token: string
  staffMemberId: string
  displayName: string
}

/** A backoffice user with the `employee` role and a linked staff team member. */
export async function createStaffPerson(
  request: APIRequestContext,
  admin: string,
  cleanup: Cleanup,
  label: string,
  roles: string[] = ['employee'],
): Promise<StaffPerson> {
  const suffix = uniqueSuffix()
  const email = `qa-support-${label}-${suffix}@acme.test`
  const password = 'Valid1!Pass'
  const { organizationId } = getTokenContext(admin)
  const displayName = `QA ${label} ${suffix}`
  const userId = await createUserFixture(request, admin, { email, password, organizationId, roles, name: displayName })
  cleanup.add(() => deleteUserIfExists(request, admin, userId))
  const member = await okJson<{ id: string }>(
    await apiRequest(request, 'POST', '/api/staff/team-members', {
      token: admin,
      data: { displayName, userId, isActive: true },
    }),
    'create team member',
  )
  cleanup.add(() => apiRequest(request, 'DELETE', `/api/staff/team-members?id=${member.id}`, { token: admin }))
  const token = await getAuthToken(request, email, password)
  return { userId, email, password, token, staffMemberId: member.id, displayName }
}

/** A staff team member without any user account. */
export async function createAccountlessMember(
  request: APIRequestContext,
  admin: string,
  cleanup: Cleanup,
): Promise<string> {
  const member = await okJson<{ id: string }>(
    await apiRequest(request, 'POST', '/api/staff/team-members', {
      token: admin,
      data: { displayName: `QA no-account ${uniqueSuffix()}`, isActive: true },
    }),
    'create accountless member',
  )
  cleanup.add(() => apiRequest(request, 'DELETE', `/api/staff/team-members?id=${member.id}`, { token: admin }))
  return member.id
}

// ---------------------------------------------------------------- projects

export async function createProject(
  request: APIRequestContext,
  admin: string,
  cleanup: Cleanup,
  label: string,
): Promise<TestTimeProjectFixture> {
  const suffix = uniqueSuffix().replace(/[^0-9]/g, '').slice(-6)
  const project = await createTestTimeProject(request, admin, {
    name: `QA Support ${label} ${suffix}`,
    code: `QS${suffix}`,
  })
  cleanup.add(() => project.cleanup())
  return project
}

export async function addProjectMember(
  request: APIRequestContext,
  admin: string,
  projectId: string,
  staffMemberId: string,
  options: { isAssigner?: boolean } = {},
): Promise<string> {
  const body = await okJson<{ id: string }>(
    await apiRequest(request, 'POST', `/api/staff/timesheets/time-projects/${projectId}/employees`, {
      token: admin,
      data: {
        staffMemberId,
        status: 'active',
        assignedStartDate: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
        isAssigner: options.isAssigner === true,
      },
    }),
    'assign project member',
  )
  return body.id
}

export async function setProjectFields(
  request: APIRequestContext,
  admin: string,
  projectId: string,
  data: Record<string, unknown>,
) {
  return apiRequest(request, 'PUT', '/api/staff/timesheets/time-projects', { token: admin, data: { id: projectId, ...data } })
}

export type TaskStatusRow = { id: string; slug: string; is_default?: boolean; is_done?: boolean; isDefault?: boolean; isDone?: boolean }

export async function listProjectStatuses(request: APIRequestContext, token: string, projectId: string): Promise<TaskStatusRow[]> {
  const body = await okJson<{ items: TaskStatusRow[] }>(
    await apiRequest(request, 'GET', `/api/staff/timesheets/task-statuses?timeProjectId=${projectId}&pageSize=100`, { token }),
    'list task statuses',
  )
  return body.items
}

export async function findStatus(
  request: APIRequestContext,
  token: string,
  projectId: string,
  kind: 'done' | 'inProgress',
): Promise<string> {
  const statuses = await listProjectStatuses(request, token, projectId)
  const isDone = (row: TaskStatusRow) => row.is_done === true || row.isDone === true
  const isDefault = (row: TaskStatusRow) => row.is_default === true || row.isDefault === true
  const match = kind === 'done' ? statuses.find(isDone) : statuses.find((row) => !isDone(row) && !isDefault(row))
  expect(match, `project ${projectId} should have a ${kind} status`).toBeTruthy()
  return match!.id
}

export async function moveTask(request: APIRequestContext, token: string, taskId: string, taskStatusId: string) {
  return apiRequest(request, 'PATCH', `/api/staff/timesheets/tasks/${taskId}/status`, { token, data: { taskStatusId } })
}

export type StaffTaskRow = {
  id: string
  time_project_id: string
  assignee_staff_member_id: string | null
  updated_at: string
  source?: string
  customer_id?: string | null
  _staffSupport?: {
    ticket: null | {
      supportReference: string
      routedVia: 'category' | 'fallback'
      portalStatus: string
      unnotifiedAt: string | null
      category: { value: string; label: string }
    }
  }
}

export async function getStaffTask(request: APIRequestContext, token: string, taskId: string): Promise<StaffTaskRow | null> {
  const response = await apiRequest(request, 'GET', `/api/staff/timesheets/tasks?id=${taskId}`, { token })
  const body = await readJsonSafe<{ items?: StaffTaskRow[] }>(response)
  return body?.items?.[0] ?? null
}

// ---------------------------------------------------------------- categories and routing

export type CategoryFixture = { value: string; label: string; entryId: string }

async function supportDictionaryId(request: APIRequestContext, admin: string): Promise<string> {
  const body = await okJson<{ items?: Array<{ id: string; key: string }> }>(
    await apiRequest(request, 'GET', '/api/dictionaries', { token: admin }),
    'list dictionaries',
  )
  const dictionary = body.items?.find((item) => item.key === SUPPORT_CATEGORY_DICTIONARY_KEY)
  expect(dictionary, 'the support category dictionary should be seeded').toBeTruthy()
  return dictionary!.id
}

/** A category unique to the calling spec, so no spec depends on the seeded entries. */
export async function createCategory(
  request: APIRequestContext,
  admin: string,
  cleanup: Cleanup,
  label: string,
): Promise<CategoryFixture> {
  const dictionaryId = await supportDictionaryId(request, admin)
  const suffix = uniqueSuffix()
  const value = `qa-${label}-${suffix}`.toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const displayLabel = `QA ${label} ${suffix}`
  const body = await okJson<{ id?: string; item?: { id?: string } }>(
    await apiRequest(request, 'POST', `/api/dictionaries/${dictionaryId}/entries`, {
      token: admin,
      data: { value, label: displayLabel },
    }),
    'create support category',
  )
  const entryId = body.id ?? body.item?.id ?? ''
  cleanup.add(() => apiRequest(request, 'DELETE', `/api/dictionaries/${dictionaryId}/entries/${entryId}`, { token: admin }))
  return { value, label: displayLabel, entryId }
}

export async function deleteCategory(request: APIRequestContext, admin: string, category: CategoryFixture) {
  const dictionaryId = await supportDictionaryId(request, admin)
  return apiRequest(request, 'DELETE', `/api/dictionaries/${dictionaryId}/entries/${category.entryId}`, { token: admin })
}

export type RoutingPreview = {
  fallback: { ruleId: string; project: { id: string; usable: boolean } } | null
  rules: Array<{ id: string; categoryValue: string | null; isActive: boolean; problem: string | null; project: { id: string } }>
  categories: Array<{ value: string; route: { via: 'category' | 'fallback'; project: { id: string } } | null }>
}

export async function routingPreview(request: APIRequestContext, admin: string): Promise<RoutingPreview> {
  return okJson<RoutingPreview>(
    await apiRequest(request, 'GET', '/api/staff/timesheets/support-routing-rules/preview', { token: admin }),
    'routing preview',
  )
}

/**
 * Makes sure a fallback rule exists and returns it. Tenant setup (`seedDefaults`) already
 * creates this rule and its "Customer support" project, so `created` is normally false.
 * When a spec does create it, it is kept on purpose: the fallback rule cannot be deleted
 * or paused through the API, and deleting its project would leave the organization with
 * an unusable fallback, which is worse than the seeded state the rule now matches.
 */
export async function ensureFallback(
  request: APIRequestContext,
  admin: string,
): Promise<{ ruleId: string; timeProjectId: string; created: boolean }> {
  const body = await okJson<{ ruleId: string; timeProjectId: string; created?: boolean }>(
    await apiRequest(request, 'POST', '/api/staff/timesheets/support-routing-rules/fallback-project', { token: admin }),
    'ensure fallback project',
  )
  return { ruleId: body.ruleId, timeProjectId: body.timeProjectId, created: body.created === true }
}

/**
 * Points the organization fallback rule at `timeProjectId` for the duration of a spec
 * and registers a cleanup step that restores the previous target.
 */
export async function pointFallbackAt(
  request: APIRequestContext,
  admin: string,
  cleanup: Cleanup,
  timeProjectId: string,
): Promise<void> {
  const fallback = await ensureFallback(request, admin)
  const response = await apiRequest(request, 'PUT', '/api/staff/timesheets/support-routing-rules', {
    token: admin,
    data: { id: fallback.ruleId, timeProjectId },
  })
  expect(response.ok(), `repoint fallback failed: ${response.status()}`).toBeTruthy()
  cleanup.add(() =>
    apiRequest(request, 'PUT', '/api/staff/timesheets/support-routing-rules', {
      token: admin,
      data: { id: fallback.ruleId, timeProjectId: fallback.timeProjectId },
    }),
  )
}

export async function createRoutingRule(
  request: APIRequestContext,
  admin: string,
  cleanup: Cleanup,
  data: { categoryValue: string; timeProjectId: string; isActive?: boolean },
): Promise<string> {
  const body = await okJson<{ id: string }>(
    await apiRequest(request, 'POST', '/api/staff/timesheets/support-routing-rules', { token: admin, data }),
    'create routing rule',
  )
  cleanup.add(() => apiRequest(request, 'DELETE', `/api/staff/timesheets/support-routing-rules?id=${body.id}`, { token: admin }))
  return body.id
}

// ---------------------------------------------------------------- portal customers

export type PortalCustomer = {
  companyId: string
  companyName: string | null
  roleId: string
  userId: string
  email: string
  password: string
  displayName: string
  session: PortalSession
}

export async function createPortalCustomer(
  request: APIRequestContext,
  admin: string,
  cleanup: Cleanup,
  options: { features: string[]; companyId?: string; label?: string },
): Promise<PortalCustomer> {
  const { tenantId } = getTokenContext(admin)
  const companyName = options.companyId ? null : `QA Support Co ${options.label ?? ''} ${uniqueSuffix()}`
  const companyId = options.companyId ?? (await createCustomerCompanyFixture(request, admin, companyName as string))
  if (!options.companyId) cleanup.add(() => deleteCustomerCompanyFixture(request, admin, companyId))
  const role = await createCustomerRoleFixture(request, admin, { features: options.features })
  cleanup.add(() => deleteCustomerRoleFixture(request, admin, role.id))
  const user = await createCustomerUserFixture(request, admin, {
    roleIds: [role.id],
    customerEntityId: companyId,
    displayName: `QA Portal ${options.label ?? 'user'}`,
  })
  cleanup.add(() => deleteCustomerUserFixture(request, admin, user.id))
  const session = await portalLogin(request, { email: user.email, password: user.password, tenantId })
  return {
    companyId,
    companyName,
    roleId: role.id,
    userId: user.id,
    email: user.email,
    password: user.password,
    displayName: user.displayName,
    session,
  }
}

export async function portalRequest(
  request: APIRequestContext,
  customer: PortalCustomer,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  data?: unknown,
) {
  return request.fetch(path, {
    method,
    headers: portalCookieHeaders(customer.session, data === undefined ? {} : { 'Content-Type': 'application/json' }),
    data: data === undefined ? undefined : JSON.stringify(data),
  })
}

export async function fileTicket(
  request: APIRequestContext,
  customer: PortalCustomer,
  data: { categoryValue: string; subject?: string; description?: string },
): Promise<{ id: string; supportReference: string }> {
  const response = await portalRequest(request, customer, 'POST', '/api/staff/portal/support-tickets', {
    categoryValue: data.categoryValue,
    subject: data.subject ?? `QA ticket ${uniqueSuffix()}`,
    description: data.description ?? 'Something is not working as expected.',
  })
  const body = await readJsonSafe<{ id: string; supportReference: string }>(response)
  expect(response.status(), `file ticket: ${JSON.stringify(body)}`).toBe(201)
  return body as { id: string; supportReference: string }
}

export async function deleteTask(request: APIRequestContext, admin: string, taskId: string) {
  return apiRequest(request, 'DELETE', `/api/staff/timesheets/tasks?id=${taskId}`, { token: admin })
}

/**
 * Registers a cleanup step that deletes every file attached to the ticket, including
 * customer uploads and files uploaded through the browser, before the task is deleted.
 */
export function cleanupTicketAttachments(request: APIRequestContext, admin: string, cleanup: Cleanup, taskId: string): void {
  cleanup.add(async () => {
    const response = await apiRequest(
      request,
      'GET',
      `/api/attachments?entityId=${encodeURIComponent('staff:staff_time_task')}&recordId=${encodeURIComponent(taskId)}`,
      { token: admin },
    )
    const items = (await readJsonSafe<{ items?: Array<{ id: string }> }>(response))?.items ?? []
    for (const item of items) await deleteAttachmentIfExists(request, admin, item.id)
  })
}

export type PortalTicketDetail = {
  id: string
  supportReference: string
  subject: string
  description: string
  portalStatus: 'received' | 'in_progress' | 'resolved'
  canReply: boolean
  messages: Array<{ id: string; authorKind: 'staff' | 'customer'; body: string }>
}

export async function getPortalTicket(
  request: APIRequestContext,
  customer: PortalCustomer,
  taskId: string,
): Promise<{ status: number; body: PortalTicketDetail | null }> {
  const response = await portalRequest(request, customer, 'GET', `/api/staff/portal/support-tickets/${taskId}`)
  return { status: response.status(), body: await readJsonSafe<PortalTicketDetail>(response) }
}

export async function staffComment(
  request: APIRequestContext,
  token: string,
  taskId: string,
  body: string,
  visibility: 'internal' | 'customer',
) {
  return apiRequest(request, 'POST', `/api/staff/timesheets/tasks/${taskId}/comments`, { token, data: { body, visibility } })
}

// ---------------------------------------------------------------- notifications

export type NotificationRow = { id: string; type: string; sourceEntityId?: string | null; source_entity_id?: string | null }

/** Polls the caller's notifications for one of `type` about `taskId`; persistent subscribers run asynchronously. */
export async function waitForNotification(
  request: APIRequestContext,
  token: string,
  type: string,
  taskId: string,
  options: { attempts?: number; expectNone?: boolean } = {},
): Promise<NotificationRow | null> {
  const attempts = options.attempts ?? (options.expectNone ? 8 : 30)
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await apiRequest(request, 'GET', `/api/notifications?type=${encodeURIComponent(type)}&pageSize=50`, { token })
    const body = await readJsonSafe<{ items?: NotificationRow[] }>(response)
    const match = body?.items?.find((item) => (item.sourceEntityId ?? item.source_entity_id) === taskId) ?? null
    if (match) return match
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return null
}

// ---------------------------------------------------------------- browser sessions

type BrowserPage = import('@playwright/test').Page

function baseUrl(): string {
  return process.env.BASE_URL || 'http://localhost:3000'
}

/** The portal URL segment of the admin token's organization. */
export async function resolveOrgSlug(request: APIRequestContext, admin: string): Promise<string> {
  const { organizationId } = getTokenContext(admin)
  const response = await apiRequest(request, 'GET', `/api/directory/organizations?view=manage&ids=${organizationId}&pageSize=10`, { token: admin })
  const body = await readJsonSafe<{ items?: Array<{ id: string; slug?: string | null }> }>(response)
  const slug = body?.items?.find((item) => item.id === organizationId)?.slug
  expect(slug, 'the organization should expose a portal slug').toBeTruthy()
  return slug as string
}

/** Signs a backoffice user into the page's browser context through the API login. */
export async function loginStaffInBrowser(page: BrowserPage, person: { email: string; password: string }): Promise<void> {
  const form = new URLSearchParams({ email: person.email, password: person.password })
  const response = await page.request.post('/api/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  })
  expect(response.ok(), `staff login failed: ${response.status()}`).toBeTruthy()
  await acknowledgeGlobalNotices(page)
  await page.goto('/backend', { waitUntil: 'domcontentloaded' })
  await page.waitForURL(/\/backend/, { timeout: 60_000 })
}

/**
 * Carries an API portal session into the browser. Production builds mark portal
 * cookies `Secure`, which a browser will not replay over plain http, so the cookies
 * are added explicitly instead of logging in through the form.
 */
export async function usePortalSessionInBrowser(page: BrowserPage, customer: PortalCustomer): Promise<void> {
  await page.context().addCookies([
    { name: 'customer_auth_token', value: customer.session.authToken, url: baseUrl(), sameSite: 'Lax' },
    { name: 'customer_session_token', value: customer.session.sessionToken, url: baseUrl(), sameSite: 'Lax' },
  ])
  await acknowledgeGlobalNotices(page)
}

export async function dismissNotices(page: BrowserPage): Promise<void> {
  for (const name of ['Dismiss', 'Accept cookies']) {
    const button = page.getByRole('button', { name, exact: true })
    if (await button.count()) await button.first().click({ timeout: 2_000 }).catch(() => undefined)
  }
}
