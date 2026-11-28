import { expect, test, type APIRequestContext, type Page, type Response } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { acknowledgeGlobalNotices, login } from '@open-mercato/core/helpers/integration/auth'
import {
  createOrganizationFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  createFeatureToggleFixture,
  deleteFeatureToggleIfExists,
} from '@open-mercato/core/helpers/integration/featureTogglesFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

export const integrationMeta = {
  dependsOnModules: ['auth', 'customers', 'directory', 'feature_toggles'],
}

const INTERACTIONS = '/api/customers/interactions'
const MERGED_TASKS = INTERACTIONS + '/tasks'
const LEGACY_TASKS = '/api/customers/todos'
const UNIFIED_FLAG = 'customers.interactions.unified'

type ToggleOverride = { id: string; value: boolean; updatedAt: string | null }

async function readOverride(request: APIRequestContext, token: string, toggleId: string): Promise<ToggleOverride> {
  const response = await apiRequest(request, 'GET', `/api/feature_toggles/global/${toggleId}/override`, { token })
  expect(response.ok(), 'The interaction-mode override should be readable').toBeTruthy()
  const body = await readJsonSafe<ToggleOverride>(response)
  expect(body, 'The interaction-mode override response should be present').toBeTruthy()
  return body as ToggleOverride
}

async function writeOverride(
  request: APIRequestContext,
  token: string,
  toggleId: string,
  isOverride: boolean,
  value: boolean,
): Promise<void> {
  const current = await readOverride(request, token, toggleId)
  const response = await apiRequest(request, 'PUT', '/api/feature_toggles/overrides', {
    token,
    headers: current.updatedAt ? { [OPTIMISTIC_LOCK_HEADER_NAME]: current.updatedAt } : {},
    data: { toggleId, isOverride, ...(isOverride ? { overrideValue: value } : {}) },
  })
  expect(response.ok(), 'The interaction-mode override should update').toBeTruthy()
}

async function useInteractionMode(
  request: APIRequestContext,
  token: string,
  unified: boolean,
): Promise<() => Promise<void>> {
  const response = await apiRequest(request, 'GET', `/api/feature_toggles/global?identifier=${UNIFIED_FLAG}&pageSize=100`, { token })
  expect(response.ok(), 'Interaction-mode feature toggles should be readable').toBeTruthy()
  const body = await readJsonSafe<{ items?: Array<{ id: string; identifier: string }> }>(response)
  const existing = body?.items?.find((item) => item.identifier === UNIFIED_FLAG)
  const toggleId = existing?.id ?? await createFeatureToggleFixture(request, token, {
    identifier: UNIFIED_FLAG,
    name: 'Unified Interactions',
    type: 'boolean',
    defaultValue: false,
  })
  const original = await readOverride(request, token, toggleId)
  const restore = async () => {
    if (!existing) {
      await deleteFeatureToggleIfExists(request, token, toggleId)
      return
    }
    await writeOverride(request, token, toggleId, Boolean(original.id), original.value)
  }
  try {
    await writeOverride(request, token, toggleId, true, unified)
  } catch (error) {
    await restore()
    throw error
  }
  return restore
}

async function createTask(
  request: APIRequestContext,
  token: string,
  entityId: string,
  title: string,
  source: string | null,
  status = 'planned',
): Promise<string> {
  const response = await apiRequest(request, 'POST', INTERACTIONS, {
    token,
    data: { entityId, interactionType: 'task', title, source, status },
  })
  expect(response.status(), 'The native task should be created').toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, 'The native task should have an id')
}

async function signInTaskActor(page: Page, email: string, password: string): Promise<void> {
  await acknowledgeGlobalNotices(page)
  const response = await page.request.post('/api/auth/login', { form: { email, password } })
  expect(response.ok(), 'The task actor should sign in through the browser session').toBeTruthy()
}

async function readTaskIds(request: APIRequestContext, token: string, endpoint: string, entityId: string): Promise<string[]> {
  const response = await apiRequest(request, 'GET', `${endpoint}?entityId=${entityId}`, { token })
  expect(response.status(), `${endpoint} should return the actor’s scoped task list`).toBe(200)
  const body = await readJsonSafe<{ items?: Array<{ todoId: string }> }>(response)
  expect(Array.isArray(body?.items), `${endpoint} should return a list of task rows`).toBeTruthy()
  return body?.items?.map((item) => item.todoId) ?? []
}

test.describe('TC-CRM-090: Customer task navigation to the person Tasks tab', () => {
  for (const status of ['canceled', 'in_progress', 'waiting']) {
    test(`preserves a native ${status} task through a compatibility-mode title edit`, async ({ page }, testInfo) => {
      await login(page, 'superadmin')
      const request = page.request
      const token = await getAuthToken(request, 'superadmin')
      let personId: string | null = null
      let taskId: string | null = null
      let restoreMode: (() => Promise<void>) | null = null
      try {
        restoreMode = await useInteractionMode(request, token, false)
        personId = await createPersonFixture(request, token, {
          firstName: 'Native', lastName: `status ${status} ${Date.now()}`, displayName: `Native ${status} fixture`,
        })
        taskId = await createTask(request, token, personId, `Native ${status}`, null, status)
        const listPath = `${INTERACTIONS}?entityId=${personId}&interactionType=task&limit=100`
        const readTask = async () => {
          const response = await apiRequest(request, 'GET', listPath, { token })
          expect(response.ok()).toBeTruthy()
          const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response)
          const record = body?.items?.find((item) => item.id === taskId)
          expect(record).toBeTruthy()
          return record as Record<string, unknown>
        }
        const before = await readTask()
        const merged = await apiRequest(request, 'GET', `/api/customers/interactions/tasks?entityId=${personId}`, { token })
        expect(merged.ok()).toBeTruthy()
        const mergedBody = await readJsonSafe<{ items?: Array<{ todoId: string; todoStatus?: string }> }>(merged)
        expect(mergedBody?.items?.find((item) => item.todoId === taskId)?.todoStatus).toBe(status)
        await page.goto(`/backend/customers/people-v2/${personId}?tab=tasks`)
        const article = page.getByRole('article').filter({ hasText: `Native ${status}` })
        await expect(article).toBeVisible()
        if (status === 'canceled') await expect(article.getByRole('checkbox')).toBeDisabled()
        await article.getByRole('button', { name: 'Edit', exact: true }).click()
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible()
        await dialog.getByRole('textbox', { name: /^Title(?:\s*\*)?$/ }).fill(`Renamed ${status}`)
        const saved = page.waitForResponse((response) => response.url().split('?')[0].endsWith(INTERACTIONS)
          && response.request().method() === 'PUT')
        await dialog.press('Control+Enter')
        expect((await saved).ok()).toBeTruthy()
        await expect(dialog).toHaveCount(0)
        const after = await readTask()
        expect(after.title).toBe(`Renamed ${status}`)
        expect(after.status).toBe(status)
        expect({ ...after, title: before.title, updatedAt: before.updatedAt }).toEqual(before)
        await page.reload()
        const renamed = page.getByRole('article').filter({ hasText: `Renamed ${status}` })
        await expect(renamed).toBeVisible()
        if (status === 'canceled') await expect(renamed.getByRole('checkbox')).toBeDisabled()
        await page.screenshot({ path: testInfo.outputPath(`compatibility-${status}-preserved.png`), fullPage: true })
      } finally {
        if (taskId) await deleteEntityIfExists(request, token, INTERACTIONS, taskId)
        if (personId) await deleteEntityIfExists(request, token, '/api/customers/people', personId)
        await restoreMode?.()
      }
    })
  }


  for (const unified of [false, true]) {
    const mode = unified ? 'unified' : 'compatibility'

    test(`keeps native tasks visible after navigation and reload in ${mode} mode`, async ({ page }, testInfo) => {
      await login(page, 'superadmin')
      const request = page.request
      const token = await getAuthToken(request, 'superadmin')
      const stamp = `${Date.now()}-${testInfo.retry}`
      const personName = `Task navigation ${stamp}`
      const taskTitles = [`Native null ${stamp}`, `Native other ${stamp}`, `Unrelated task ${stamp}`]
      const personIds: string[] = []
      const taskIds: string[] = []
      let restoreMode: (() => Promise<void>) | null = null

      try {
        restoreMode = await useInteractionMode(request, token, unified)
        personIds.push(await createPersonFixture(request, token, {
          firstName: 'Task', lastName: `navigation ${stamp}`, displayName: personName,
        }))
        personIds.push(await createPersonFixture(request, token, {
          firstName: 'Unrelated', lastName: `person ${stamp}`, displayName: `Unrelated person ${stamp}`,
        }))
        taskIds.push(await createTask(request, token, personIds[0], taskTitles[0], null))
        taskIds.push(await createTask(request, token, personIds[0], taskTitles[1], 'qa:profile-navigation', 'done'))
        taskIds.push(await createTask(request, token, personIds[1], taskTitles[2], null))

        const overviewResponse = await apiRequest(request, 'GET', `/api/customers/people/${personIds[0]}`, { token })
        expect(overviewResponse.ok()).toBeTruthy()
        const overview = await readJsonSafe<{ interactionMode?: string }>(overviewResponse)
        expect(overview?.interactionMode).toBe(unified ? 'canonical' : 'legacy')

        await page.goto('/backend/customer-tasks')
        await expect(page.getByRole('heading', { name: 'Customer related tasks', exact: true })).toBeVisible()
        await page.getByRole('searchbox', { name: 'Search', exact: true }).fill(stamp)
        const taskRow = page.getByRole('row').filter({ hasText: taskTitles[0] })
        await expect(taskRow).toBeVisible()
        await expect(page.getByRole('row').filter({ hasText: taskTitles[1] })).toBeVisible()
        await expect(page.getByRole('row').filter({ hasText: taskTitles[2] })).toBeVisible()
        await page.screenshot({ path: testInfo.outputPath(`${mode}-global-tasks.png`), fullPage: true })
        await taskRow.getByRole('link', { name: personName, exact: true }).click()

        await expect(page).toHaveURL(new RegExp(`/backend/customers/people-v2/${personIds[0]}\\?tab=tasks$`))
        await expect(page.getByRole('heading', { name: personName, exact: true })).toBeVisible()
        await expect(page.getByRole('tab', { name: /^Tasks(?:\s+\d+)?$/ })).toHaveAttribute('aria-selected', 'true')
        const nativeTask = page.getByRole('article').filter({ hasText: taskTitles[0] })
        const completedTask = page.getByRole('article').filter({ hasText: taskTitles[1] })
        await expect(nativeTask).toBeVisible()
        await expect(completedTask).toBeVisible()
        await expect(nativeTask.getByRole('checkbox')).not.toBeChecked()
        await expect(completedTask.getByRole('checkbox')).toBeChecked()
        await expect(page.getByText(taskTitles[2], { exact: true })).toHaveCount(0)

        await page.reload()
        await expect(page.getByRole('tab', { name: /^Tasks(?:\s+\d+)?$/ })).toHaveAttribute('aria-selected', 'true')
        await expect(nativeTask).toBeVisible()
        await expect(completedTask.getByRole('checkbox')).toBeChecked()
        await expect(page.getByText(taskTitles[2], { exact: true })).toHaveCount(0)
        await page.screenshot({ path: testInfo.outputPath(`${mode}-person-tasks.png`), fullPage: true })
      } finally {
        for (const taskId of taskIds) await deleteEntityIfExists(request, token, INTERACTIONS, taskId)
        for (const personId of personIds) await deleteEntityIfExists(request, token, '/api/customers/people', personId)
        await restoreMode?.()
      }
    })
  }
  for (const unified of [false, true]) {
    const mode = unified ? 'unified' : 'compatibility'

    test(`preserves legacy access and task scope at the dispatch boundary in ${mode} mode`, async ({ page, request }, testInfo) => {
      test.setTimeout(90_000)
      const [setupToken, adminToken] = await withCredentialIsolatedRequest(async (loginRequest) => [
        await getAuthToken(loginRequest, 'superadmin'),
        await getAuthToken(loginRequest, 'admin'),
      ])
      const { tenantId, organizationId } = getTokenContext(adminToken)
      expect(tenantId).toBeTruthy()
      expect(organizationId).toBeTruthy()
      const stamp = `${Date.now()}-${testInfo.retry}`
      const password = 'Integration-Task-Actor-8746!'
      const userIds: string[] = []
      const taskIds: string[] = []
      let personId: string | null = null
      let siblingOrganizationId: string | null = null
      let restoreMode: (() => Promise<void>) | null = null

      async function createActor(suffix: string, actorOrganizationId: string, features: string[]) {
        const email = `crm090-${suffix}-${stamp}@example.org`
        const userId = await createUserFixture(request, setupToken, {
          email,
          password,
          organizationId: actorOrganizationId,
          roles: [],
        })
        userIds.push(userId)
        if (features.length) {
          await setUserAclVisibility(request, setupToken, { userId, organizations: [actorOrganizationId], features })
        }
        const token = await withCredentialIsolatedRequest((loginRequest) => getAuthToken(loginRequest, email, password))
        expect(getTokenContext(token)).toEqual({ tenantId, organizationId: actorOrganizationId })
        return { email, token }
      }

      try {
        restoreMode = await useInteractionMode(request, setupToken, unified)
        siblingOrganizationId = await createOrganizationFixture(request, setupToken, {
          name: `CRM-090 sibling ${stamp}`,
          tenantId,
        })
        const personName = `Task permission fixture ${stamp}`
        personId = await createPersonFixture(request, adminToken, {
          firstName: 'Task', lastName: `permission ${stamp}`, displayName: personName,
        })
        const nativeTitle = `Native task ${stamp}`
        const legacyTitle = `Adapter task ${stamp}`
        const nativeTaskId = await createTask(request, adminToken, personId, nativeTitle, null, 'waiting')
        taskIds.push(nativeTaskId)
        const legacyCreate = await apiRequest(request, 'POST', LEGACY_TASKS, {
          token: adminToken,
          data: { entityId: personId, title: legacyTitle },
        })
        expect(legacyCreate.status(), 'The legacy adapter should create a task visible to existing roles').toBe(201)
        const legacyTask = await readJsonSafe<{ todoId?: string }>(legacyCreate)
        const legacyTaskId = expectId(legacyTask?.todoId, 'The adapter task should have an id')
        taskIds.push(legacyTaskId)

        const legacyFeatures = ['customers.view', 'customers.people.view']
        const legacy = await createActor('legacy', organizationId, legacyFeatures)
        const denied = await createActor('denied', organizationId, [])
        const foreignLegacy = await createActor('foreign-legacy', siblingOrganizationId, legacyFeatures)
        const wildcard = await createActor('wildcard', organizationId, ['customers.*'])
        const foreignWildcard = await createActor('foreign-wildcard', siblingOrganizationId, ['customers.*'])
        const query = `?entityId=${personId}`

        async function expectDenied(endpoint: string, token: string) {
          const response = await apiRequest(request, 'GET', endpoint + query, { token })
          expect(response.status(), `${endpoint} should refuse a caller without its feature`).toBe(403)
        }

        await expectDenied(MERGED_TASKS, legacy.token)
        await expectDenied(MERGED_TASKS, denied.token)
        await expectDenied(LEGACY_TASKS, denied.token)
        await expectDenied(MERGED_TASKS, foreignLegacy.token)
        const ownLegacyIds = await readTaskIds(request, legacy.token, LEGACY_TASKS, personId)
        expect(ownLegacyIds).toContain(legacyTaskId)
        if (!unified) expect(ownLegacyIds).not.toContain(nativeTaskId)
        expect(await readTaskIds(request, wildcard.token, MERGED_TASKS, personId)).toEqual(
          expect.arrayContaining([nativeTaskId, legacyTaskId]),
        )
        const deniedWrite = await apiRequest(request, 'PUT', INTERACTIONS, {
          token: legacy.token,
          data: { id: nativeTaskId, title: 'Forbidden update' },
        })
        expect(deniedWrite.status(), 'Legacy read grants must not enable native task updates').toBe(403)

        for (const [endpoint, token] of [
          [LEGACY_TASKS, foreignLegacy.token],
          [LEGACY_TASKS, foreignWildcard.token],
          [MERGED_TASKS, foreignWildcard.token],
        ]) {
          const foreignIds = await readTaskIds(request, token, endpoint, personId)
          expect(foreignIds).not.toContain(nativeTaskId)
          expect(foreignIds).not.toContain(legacyTaskId)
        }

        const foreignWrite = await apiRequest(request, 'PUT', INTERACTIONS, {
          token: foreignWildcard.token,
          data: { id: nativeTaskId, title: 'Wrong-scope update' },
        })
        expect([403, 404], 'A wildcard grant must not permit updates in a sibling organization').toContain(foreignWrite.status())

        await signInTaskActor(page, legacy.email, password)
        const browserReads: Array<{ endpoint: string; status: number }> = []
        const observeTaskRead = (response: Response) => {
          const url = new URL(response.url())
          if (response.request().method() !== 'GET' || url.searchParams.get('entityId') !== personId) return
          if (url.pathname === INTERACTIONS && url.searchParams.get('interactionType') !== 'task') return
          if ([INTERACTIONS, MERGED_TASKS, LEGACY_TASKS].includes(url.pathname)) {
            browserReads.push({ endpoint: url.pathname, status: response.status() })
          }
        }
        page.on('response', observeTaskRead)
        try {
          await page.goto(`/backend/customers/people-v2/${personId}?tab=tasks`)
          await expect(page.getByRole('heading', { name: personName, exact: true })).toBeVisible()
          const tasksTab = page.getByRole('tab', { name: /^Tasks(?:\s+\d+)?$/ })
          if (unified) {
            await expect(page.getByRole('tab', { name: 'Emails', exact: true })).toHaveAttribute('aria-selected', 'true')
            await expect(tasksTab).toHaveCount(0)
          } else {
            await expect(tasksTab).toHaveAttribute('aria-selected', 'true')
            await expect.poll(() => browserReads).toContainEqual({ endpoint: LEGACY_TASKS, status: 200 })
            await expect(page.getByRole('article').filter({ hasText: legacyTitle })).toBeVisible()
          }
          expect(browserReads.every(({ endpoint, status }) => endpoint === LEGACY_TASKS && status === 200)).toBe(true)
          await expect(page.getByRole('article').filter({ hasText: nativeTitle })).toHaveCount(0)
          await page.screenshot({ path: testInfo.outputPath(`${mode}-legacy-role-tasks.png`), fullPage: true })
        } finally {
          page.off('response', observeTaskRead)
        }
      } finally {
        for (const taskId of taskIds) await deleteEntityIfExists(request, adminToken, INTERACTIONS, taskId)
        if (personId) await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
        for (const userId of userIds) await deleteUserIfExists(request, setupToken, userId)
        await deleteOrganizationIfExists(request, setupToken, siblingOrganizationId)
        await restoreMode?.()
      }
    })
  }
})
