import { expect, request as playwrightRequest, test, type APIRequestContext, type Page, type Request, type Response, type Route, type TestInfo } from '@playwright/test'
import { acknowledgeGlobalNotices } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { readJsonSafe as readResponseJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import english from '../../i18n/en.json' with { type: 'json' }
import polish from '../../i18n/pl.json' with { type: 'json' }
import { createBoardFixture, TASKS_PATH, type BoardFixture } from './taskBoardFixtures'

export type BoardLocale = 'en' | 'pl'
export type BoardPersona = 'manager' | 'employee'

export function boardCopy(locale: BoardLocale) {
  const dictionary = locale === 'pl' ? polish : english
  return {
    newTask: dictionary['staff.time_tracking.board.newTask.cta'],
    dialog: dictionary['staff.time_tracking.board.newTask.title'],
    title: dictionary['staff.time_tracking.board.newTask.titleLabel'],
    status: dictionary['staff.time_tracking.board.newTask.status'],
    create: dictionary['staff.time_tracking.board.newTask.submit'],
    cancel: dictionary['staff.time_tracking.board.newTask.cancel'],
    assignee: dictionary['staff.time_tracking.taskDrawer.properties.assignee'],
    filters: dictionary['staff.time_tracking.board.filters.cta'],
  }
}

type ScenarioContext = {
  page: Page
  fixture: BoardFixture
  baseURL: string
  testInfo: TestInfo
}

function rethrowWithRedactedCredentials(error: unknown): never {
  const redact = (message: string) => message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED]')
    .replace(/(auth_token|session_token)=[^;\s]+/g, '$1=[REDACTED]')
  if (error instanceof Error && redact(error.stack ?? error.message) !== (error.stack ?? error.message)) {
    const safe = new Error(redact(error.message))
    safe.stack = redact(error.stack ?? safe.stack ?? error.message)
    throw safe
  }
  throw error
}

export function prepareBoardScenario(persona: BoardPersona, options: { secondProject?: boolean } = {}) {
  let provisionRequest: APIRequestContext | undefined
  let fixture: BoardFixture | undefined
  test.beforeAll(async ({}, testInfo) => {
    provisionRequest = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL })
    try { fixture = await createBoardFixture(provisionRequest, persona, options) } catch (error) { rethrowWithRedactedCredentials(error) }
  })
  test.afterAll(async () => {
    try { await fixture?.cleanup() } catch (error) { rethrowWithRedactedCredentials(error) } finally { await provisionRequest?.dispose() }
  })
  return async (page: Page, testInfo: TestInfo, body: (context: ScenarioContext) => Promise<void>) => {
    if (!fixture || typeof testInfo.project.use.baseURL !== 'string') throw new Error('[internal] board fixture or runner base URL unavailable')
    try { await body({ page, fixture, baseURL: testInfo.project.use.baseURL, testInfo }) } catch (error) { rethrowWithRedactedCredentials(error) }
  }
}

function gate() {
  let release: () => void = () => undefined
  const pending = new Promise<void>((resolve) => { release = resolve })
  return { pending, release }
}

export async function openBoard(page: Page, fixture: BoardFixture, locale: BoardLocale, baseURL: string, options: { coldScope?: boolean; global?: boolean; holdStatuses?: boolean } = {}) {
  const copy = boardCopy(locale)
  await page.context().addCookies([
    { name: 'auth_token', value: fixture.token, url: baseURL, httpOnly: true, sameSite: 'Lax' },
    { name: 'locale', value: locale, url: baseURL, sameSite: 'Lax' },
    { name: 'om_selected_org', value: fixture.organizationId, url: baseURL, sameSite: 'Lax' },
    { name: 'om_selected_tenant', value: fixture.tenantId, url: baseURL, sameSite: 'Lax' },
  ])
  await acknowledgeGlobalNotices(page)
  if (options.coldScope) {
    await page.context().clearCookies({ name: /^om_selected_(org|tenant)$/ })
    const cookies = await page.context().cookies()
    expect(cookies.filter((cookie) => /^om_selected_(org|tenant)$/.test(cookie.name)).map((cookie) => cookie.name)).toEqual([])
    expect(cookies.some((cookie) => cookie.name === 'auth_token' && cookie.value === fixture.token)).toBe(true)
    expect(cookies.some((cookie) => cookie.name === 'locale' && cookie.value === locale)).toBe(true)
  }
  const organizationGate = gate()
  const statusGate = gate()
  if (!options.coldScope) organizationGate.release()
  if (!options.holdStatuses) statusGate.release()
  let statusRequests = 0
  const directoryRequests: string[] = []
  const forbidden: string[] = []
  const matchesStatus = (url: string) => {
    const parsed = new URL(url)
    return parsed.pathname === '/api/staff/timesheets/task-statuses' && parsed.searchParams.get('timeProjectId') === fixture.projectId
  }
  const onRequest = (request: Request) => {
    if (request.method() === 'GET' && matchesStatus(request.url())) statusRequests += 1
    if (new URL(request.url()).pathname === '/api/staff/team-members') directoryRequests.push(request.url())
  }
  const onResponse = (response: Response) => {
    const path = new URL(response.url()).pathname
    if (response.status() === 403 && path.startsWith('/api/staff/')) forbidden.push(path)
  }
  const organizationHandler = async (route: Route) => {
    await organizationGate.pending
    if (!page.isClosed()) await route.continue()
  }
  const statusHandler = async (route: Route) => {
    await statusGate.pending
    if (!page.isClosed()) await route.continue()
  }
  const organizationPattern = '**/api/directory/organization-switcher**'
  const statusPattern = '**/api/staff/timesheets/task-statuses?**'
  if (options.coldScope) await page.route(organizationPattern, organizationHandler)
  if (options.holdStatuses) await page.route(statusPattern, statusHandler)
  page.on('request', onRequest)
  page.on('response', onResponse)
  const surface = {
    get statusRequests() { return statusRequests },
    directoryRequests,
    forbidden,
    async releaseScope() {
      const before = statusRequests
      const settled = page.waitForResponse((response) => matchesStatus(response.url()) && response.ok())
      organizationGate.release()
      await settled
      await expect.poll(() => statusRequests).toBe(before + 1)
      await page.unroute(organizationPattern, organizationHandler)
    },
    async releaseStatusOptions() {
      const loaded = page.waitForResponse((response) => matchesStatus(response.url()) && response.ok())
      statusGate.release()
      await loaded
      await page.unroute(statusPattern, statusHandler)
    },
    async dispose() {
      organizationGate.release()
      statusGate.release()
      page.off('request', onRequest)
      page.off('response', onResponse)
      if (page.isClosed()) return
      await page.unroute(organizationPattern, organizationHandler)
      await page.unroute(statusPattern, statusHandler)
    },
  }
  try {
    const ready = [page.waitForResponse((response) => new URL(response.url()).pathname === '/api/staff/team-members/self' && response.ok())]
    if (!options.holdStatuses) ready.push(page.waitForResponse((response) => matchesStatus(response.url()) && response.ok()))
    const path = options.global
      ? `/backend/staff/time-tracking/board?projectId=${fixture.projectId}`
      : `/backend/staff/time-tracking/projects/${fixture.projectId}/board`
    await Promise.all([...ready, page.goto(path, { waitUntil: 'domcontentloaded' })])
    await expect(page.getByRole('button', { name: copy.newTask, exact: true })).toBeVisible()
    await expect.poll(() => statusRequests).toBe(1)
    if (!options.holdStatuses) await expect(page.getByText(fixture.seedTaskTitle, { exact: true })).toBeVisible()
    return surface
  } catch (error) {
    await surface.dispose()
    throw error
  }
}

export async function enterTaskDraft(page: Page, locale: BoardLocale, title: string, statusName?: string) {
  const copy = boardCopy(locale)
  await page.getByRole('button', { name: copy.newTask, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: copy.dialog, exact: true })
  await dialog.getByRole('textbox', { name: copy.title, exact: true }).fill(title)
  if (statusName) {
    await dialog.getByRole('combobox', { name: copy.status, exact: true }).click()
    await page.getByRole('option', { name: statusName, exact: true }).click()
    await expect(page.getByRole('listbox')).toHaveCount(0)
  }
  return dialog
}

export async function assertTaskDraft(page: Page, locale: BoardLocale, title: string, statusName: string) {
  const copy = boardCopy(locale)
  const dialog = page.getByRole('dialog', { name: copy.dialog, exact: true })
  await expect(dialog.getByRole('textbox', { name: copy.title, exact: true })).toHaveValue(title)
  await expect(dialog.getByRole('combobox', { name: copy.status, exact: true })).toHaveText(statusName)
}

export async function assertBoardDirectoryAccess(page: Page, surface: { forbidden: string[]; directoryRequests: string[] }, persona: BoardPersona) {
  expect(surface.forbidden, 'A permitted board and reopened drawer must not issue forbidden staff requests').toEqual([])
  if (persona === 'employee') expect(surface.directoryRequests, 'An employee without staff.view must never request the directory').toEqual([])
  else await expect.poll(() => surface.directoryRequests.length).toBeGreaterThan(0)
  await expect(page.getByRole('alert').filter({ hasText: /Access denied|Brak dostępu|Odmowa dostępu|admin/i })).toHaveCount(0)
}

export async function saveAndReopenTask(page: Page, fixture: BoardFixture, locale: BoardLocale, title: string, statusId: string, statusName: string, options: { keyboard?: boolean } = {}) {
  const copy = boardCopy(locale)
  const dialog = page.getByRole('dialog', { name: copy.dialog, exact: true })
  const isCreate = (request: Request) => request.method() === 'POST' && new URL(request.url()).pathname === TASKS_PATH
  const [submitted, response] = await Promise.all([
    page.waitForRequest(isCreate),
    page.waitForResponse((response) => isCreate(response.request())),
    options.keyboard
      ? dialog.getByRole('textbox', { name: copy.title, exact: true }).press('Control+Enter')
      : dialog.getByRole('button', { name: copy.create, exact: true }).click(),
  ])
  const payload: unknown = submitted.postDataJSON()
  expect(payload).toEqual({ title, timeProjectId: fixture.projectId, taskStatusId: statusId, assigneeStaffMemberId: fixture.memberId })
  expect(response.status()).toBe(201)
  const created = await readResponseJsonSafe<unknown>(await response.text())
  const taskId = expectId(created && typeof created === 'object' && 'id' in created ? created.id : null, 'The submitted task should have an id')
  const assertDrawer = async () => {
    const drawer = page.getByRole('dialog', { name: title, exact: true })
    await expect(drawer.getByRole('heading', { name: title, exact: true })).toBeVisible()
    await expect(drawer).toContainText(fixture.projectName)
    await expect(drawer.getByRole('combobox', { name: copy.status, exact: true })).toHaveText(statusName)
    await expect(drawer.getByRole('combobox', { name: copy.assignee, exact: true })).toHaveText(fixture.memberName)
  }
  await assertDrawer()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await test.step('Reload the saved task board', () => page.reload({ waitUntil: 'domcontentloaded' }))
  await page.getByText(title, { exact: true }).click()
  await assertDrawer()
  const readback = await apiRequest(fixture.request, 'GET', `${TASKS_PATH}?id=${taskId}&pageSize=1`, { token: fixture.token })
  expect(readback.status()).toBe(200)
  const body = await readJsonSafe<{ items: Array<Record<string, unknown>> }>(readback)
  expect(body?.items).toHaveLength(1)
  expect(body?.items[0]).toMatchObject({ id: taskId, title, time_project_id: fixture.projectId, task_status_id: statusId, assignee_staff_member_id: fixture.memberId })
}
