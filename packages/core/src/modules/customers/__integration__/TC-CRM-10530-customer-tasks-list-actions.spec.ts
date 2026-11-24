import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { acknowledgeGlobalNotices, login } from '@open-mercato/core/helpers/integration/auth'
import {
  createUserFixture,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, getTokenContext, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectConflictBanner } from '@open-mercato/core/helpers/integration/optimisticLockUi'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

export const integrationMeta = {
  dependsOnModules: ['auth', 'customers'],
}

const INTERACTIONS = '/api/customers/interactions'
const TASKS = `${INTERACTIONS}/tasks`
const TASKS_PAGE = '/backend/customer-tasks'

type TaskRow = {
  todoId: string
  todoTitle: string | null
  todoIsDone: boolean | null
  todoUpdatedAt?: string | null
}

async function createTask(
  request: APIRequestContext,
  token: string,
  entityId: string,
  input: { title: string; status?: string; priority?: number; scheduledAt?: string; ownerUserId?: string },
): Promise<string> {
  const response = await apiRequest(request, 'POST', INTERACTIONS, {
    token,
    data: { entityId, interactionType: 'task', status: 'planned', ...input },
  })
  expect(response.status(), `task "${input.title}" should be created`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, `task "${input.title}" should return an id`)
}

async function listTaskTitles(request: APIRequestContext, token: string, query: string): Promise<string[]> {
  const response = await apiRequest(request, 'GET', `${TASKS}?${query}`, { token })
  expect(response.status(), `tasks list should load for ${query}`).toBe(200)
  const body = await readJsonSafe<{ items?: TaskRow[] }>(response)
  return (body?.items ?? []).map((item) => item.todoTitle ?? '').sort()
}

async function readTask(request: APIRequestContext, token: string, entityId: string, taskId: string): Promise<TaskRow> {
  const response = await apiRequest(request, 'GET', `${TASKS}?entityId=${entityId}&pageSize=100`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ items?: TaskRow[] }>(response)
  const task = body?.items?.find((item) => item.todoId === taskId)
  expect(task, `task ${taskId} should be listed`).toBeTruthy()
  return task as TaskRow
}

async function openTasksList(page: Page, searchTerm: string): Promise<void> {
  await page.goto(TASKS_PAGE)
  const search = page.getByRole('textbox', { name: /search/i }).or(page.getByPlaceholder(/search/i)).first()
  await search.fill(searchTerm)
}

function taskRow(page: Page, title: string): Locator {
  return page.getByRole('row').filter({ hasText: title })
}

test.describe('TC-CRM-10530: Customer related tasks list can open, complete and filter native CRM tasks', () => {
  test('filters native CRM tasks by status, due date, priority and owner on the server', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { userId } = getTokenScope(token)
    const stamp = Date.now()
    let personId: string | null = null
    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'Tasks',
        lastName: `Filter ${stamp}`,
        displayName: `Tasks Filter ${stamp}`,
      })
      const scope = `entityId=${personId}`
      await createTask(request, token, personId, {
        title: `Open high ${stamp}`,
        priority: 90,
        scheduledAt: '2026-11-10T09:00:00.000Z',
        ownerUserId: userId,
      })
      await createTask(request, token, personId, {
        title: `Open low ${stamp}`,
        priority: 10,
        scheduledAt: '2026-12-15T09:00:00.000Z',
      })
      await createTask(request, token, personId, { title: `Done ${stamp}`, status: 'done' })

      expect(await listTaskTitles(request, token, `${scope}&status=open`)).toEqual([`Open high ${stamp}`, `Open low ${stamp}`])
      expect(await listTaskTitles(request, token, `${scope}&status=done`)).toEqual([`Done ${stamp}`])
      expect(await listTaskTitles(request, token, `${scope}&dueFrom=2026-11-01&dueTo=2026-11-30`)).toEqual([`Open high ${stamp}`])
      expect(await listTaskTitles(request, token, `${scope}&priorityMin=50`)).toEqual([`Open high ${stamp}`])
      expect(await listTaskTitles(request, token, `${scope}&priorityMax=50`)).toEqual([`Open low ${stamp}`])
      expect(await listTaskTitles(request, token, `${scope}&ownerUserId=me`)).toEqual([`Open high ${stamp}`])
      expect(await listTaskTitles(request, token, `${scope}&status=open&all=true`)).toEqual([`Open high ${stamp}`, `Open low ${stamp}`])

      const paged = await apiRequest(request, 'GET', `${TASKS}?${scope}&status=open&page=2&pageSize=1&sortField=priority&sortDir=desc`, { token })
      expect(paged.status()).toBe(200)
      const pagedBody = await readJsonSafe<{ items?: TaskRow[]; total?: number }>(paged)
      expect(pagedBody?.total).toBe(2)
      expect(pagedBody?.items?.map((item) => item.todoTitle)).toEqual([`Open low ${stamp}`])
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('opens a native CRM task from the list, edits it in place and toggles done', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const title = `List task ${stamp}`
    const renamed = `List task renamed ${stamp}`
    let personId: string | null = null
    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'Tasks',
        lastName: `List ${stamp}`,
        displayName: `Tasks List ${stamp}`,
      })
      const taskId = await createTask(request, token, personId, { title, priority: 40 })

      await login(page, 'admin')
      await openTasksList(page, `${stamp}`)
      const row = taskRow(page, title)
      await expect(row).toBeVisible()
      await expect(row).toContainText('40')

      await row.getByRole('button', { name: title }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await expect(page).toHaveURL(new RegExp(`${TASKS_PAGE}(\\?.*)?$`))
      const titleInput = dialog.getByRole('textbox', { name: /title/i }).first()
      await expect(titleInput).toHaveValue(title)
      await titleInput.fill(renamed)
      await dialog.getByRole('button', { name: /update task/i }).click()
      await expect(dialog).toBeHidden()
      await expect(taskRow(page, renamed)).toBeVisible()

      await taskRow(page, renamed).getByRole('checkbox').click()
      await expect(taskRow(page, renamed)).toHaveCount(0)
      const completed = await readTask(request, token, personId, taskId)
      expect(completed.todoIsDone).toBe(true)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('rejects a stale done toggle with 409 and shows the conflict bar', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const title = `Stale task ${stamp}`
    let personId: string | null = null
    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'Tasks',
        lastName: `Stale ${stamp}`,
        displayName: `Tasks Stale ${stamp}`,
      })
      const taskId = await createTask(request, token, personId, { title })
      const loaded = await readTask(request, token, personId, taskId)

      await login(page, 'admin')
      await openTasksList(page, `${stamp}`)
      await expect(taskRow(page, title)).toBeVisible()

      const bump = await apiRequest(request, 'PUT', INTERACTIONS, {
        token,
        data: { id: taskId, body: `Edited elsewhere ${stamp}` },
      })
      expect(bump.ok(), 'the out-of-band edit should succeed').toBeTruthy()

      const stale = await apiRequest(request, 'POST', `${INTERACTIONS}/complete`, {
        token,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: String(loaded.todoUpdatedAt) },
        data: { id: taskId },
      })
      expect(stale.status(), 'a stale complete should be rejected').toBe(409)

      await taskRow(page, title).getByRole('checkbox').click()
      await expectConflictBanner(page)
      const unchanged = await readTask(request, token, personId, taskId)
      expect(unchanged.todoIsDone).toBe(false)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
  test('keeps the list read-only for a user without the interactions manage feature', async ({ page, request }) => {
    const [setupToken, adminToken] = await withCredentialIsolatedRequest(async (loginRequest) => [
      await getAuthToken(loginRequest, 'superadmin'),
      await getAuthToken(loginRequest, 'admin'),
    ])
    const { organizationId } = getTokenContext(adminToken)
    const stamp = Date.now()
    const title = `Read only task ${stamp}`
    const email = `crm10530-viewer-${stamp}@example.org`
    const password = 'Integration-Task-Viewer-10530!'
    let personId: string | null = null
    let userId: string | null = null
    try {
      personId = await createPersonFixture(request, adminToken, {
        firstName: 'Tasks',
        lastName: `Viewer ${stamp}`,
        displayName: `Tasks Viewer ${stamp}`,
      })
      await createTask(request, adminToken, personId, { title })
      userId = await createUserFixture(request, setupToken, { email, password, organizationId, roles: [] })
      await setUserAclVisibility(request, setupToken, {
        userId,
        organizations: [organizationId],
        features: ['customers.view', 'customers.people.view', 'customers.interactions.view'],
      })

      await acknowledgeGlobalNotices(page)
      const signIn = await page.request.post('/api/auth/login', { form: { email, password } })
      expect(signIn.ok(), 'the view-only user should sign in').toBeTruthy()
      await openTasksList(page, `${stamp}`)
      const row = taskRow(page, title)
      await expect(row).toBeVisible()
      await expect(row.getByRole('checkbox')).toHaveCount(0)
      await expect(row.getByRole('button', { name: title })).toHaveCount(0)
      await expect(row.getByRole('link', { name: title })).toBeVisible()
    } finally {
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
      await deleteUserIfExists(request, setupToken, userId)
    }
  })
})
