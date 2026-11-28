import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

const PEOPLE = '/api/customers/people'
const INTERACTIONS = '/api/customers/interactions'
const PAGE_SIZE = 20

test('TC-CRM-5404: person tasks offer another page after exactly 20 tasks', async ({ page, request }) => {
  const token = await getAuthToken(request)
  const titlePrefix = `QA tasks ${randomUUID()}`
  const personId = await createPersonFixture(request, token, {
    firstName: 'QA',
    lastName: 'Tasks',
    displayName: titlePrefix,
  })
  const taskIds: string[] = []

  try {
    for (let index = 1; index <= PAGE_SIZE; index += 1) {
      const response = await apiRequest(request, 'POST', INTERACTIONS, {
        token,
        data: { entityId: personId, interactionType: 'task', title: `${titlePrefix} ${index}`, status: 'planned' },
      })
      expect(response.status(), `Create task ${index}`).toBe(201)
      const created = await readJsonSafe<{ id: string }>(response)
      taskIds.push(expectId(created?.id, 'Created task id'))
    }

    await login(page, 'admin')
    const waitForTaskPage = (pageNumber: number) => page.waitForResponse((response) => {
      const url = new URL(response.url())
      return response.request().method() === 'GET'
        && url.pathname === `${INTERACTIONS}/tasks`
        && url.searchParams.get('entityId') === personId
        && url.searchParams.get('page') === String(pageNumber)
        && url.searchParams.get('pageSize') === String(PAGE_SIZE)
    })
    const [firstResponse] = await Promise.all([
      waitForTaskPage(1),
      page.goto(`/backend/customers/people/${personId}?tab=tasks`, { waitUntil: 'domcontentloaded' }),
    ])
    expect(firstResponse.ok(), 'Person task page 1').toBe(true)
    const firstPage = await firstResponse.json() as { items: unknown[] }
    expect(firstPage).toMatchObject({ page: 1, total: PAGE_SIZE, totalPages: 1 })
    expect(firstPage.items).toHaveLength(PAGE_SIZE)

    const taskCards = page.getByRole('article').filter({ hasText: titlePrefix })
    const loadMore = page.getByRole('button', { name: 'Load more', exact: true })
    await expect(taskCards).toHaveCount(PAGE_SIZE)
    await expect(loadMore).toBeVisible()

    const [nextResponse] = await Promise.all([waitForTaskPage(2), loadMore.scrollIntoViewIfNeeded()])
    expect(nextResponse.ok(), 'Person task page 2').toBe(true)
    expect(await nextResponse.json()).toMatchObject({ page: 2, items: [] })
    await expect(page.getByRole('button', { name: /^(Load more|Loading…)$/ })).toHaveCount(0)
    await expect(taskCards).toHaveCount(PAGE_SIZE)
  } finally {
    await Promise.all(taskIds.map((id) => deleteEntityIfExists(request, token, INTERACTIONS, id)))
    await deleteEntityIfExists(request, token, PEOPLE, personId)
  }
})
