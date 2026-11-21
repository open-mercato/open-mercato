import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { Cleanup, loginStaffInBrowser } from './support/fixtures'
import { createIssue8204DrawerFixture, expectIssue8204NoticeInView } from './helpers/issue8204Visibility'

const cleanup = new Cleanup()
let request: APIRequestContext
let token: string
let fixture: Awaited<ReturnType<typeof createIssue8204DrawerFixture>>

test.beforeAll(async ({ playwright, baseURL }) => {
  request = await playwright.request.newContext({ baseURL })
  token = await getAuthToken(request, 'admin')
  fixture = await createIssue8204DrawerFixture(request, token, cleanup)
})

test.afterAll(async () => {
  await cleanup.run()
  await request?.dispose()
})

test('a stale status change reveals the refreshed-version notice and a clean retry stays at Properties', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 600 })
  await loginStaffInBrowser(page, fixture.actor)
  await page.goto(`/backend/staff/time-tracking/projects/${fixture.project.id}/board?task=${fixture.taskId}`)
  const drawer = page.getByRole('dialog')
  const status = drawer.getByRole('combobox', { name: 'Status', exact: true })
  const statusPath = `/api/staff/timesheets/tasks/${fixture.taskId}/status`
  await page.route(`**${statusPath}`, async (route) => {
    expect(route.request().headers()['x-om-ext-optimistic-lock-expected-updated-at']).toBeTruthy()
    const bumped = await apiRequest(request, 'PUT', '/api/staff/timesheets/tasks', {
      token,
      data: { id: fixture.taskId, title: `${fixture.title} refreshed` },
    })
    expect(bumped.ok()).toBeTruthy()
    await route.continue()
  }, { times: 1 })
  const rejected = page.waitForResponse((response) => new URL(response.url()).pathname === statusPath)
  await status.click()
  await page.getByRole('option', { name: 'In progress', exact: true }).click()
  expect((await rejected).status()).toBe(409)
  const notice = drawer.getByTestId('task-drawer-notice')
  await expect(notice).toHaveText('Someone else changed this task. It now shows the latest version. Check it and try again.')
  await expectIssue8204NoticeInView(notice, drawer)
  await testInfo.attach('stale-status-notice-visible', { body: await page.screenshot(), contentType: 'image/png' })

  await expect(drawer.getByRole('heading', { name: `${fixture.title} refreshed`, exact: true })).toBeVisible()
  await drawer.getByTestId('record-conflict-banner').getByRole('button', { name: 'Dismiss', exact: true }).click()
  const saved = page.waitForResponse((response) => new URL(response.url()).pathname === statusPath)
  await status.click()
  await page.getByRole('option', { name: 'In progress', exact: true }).click()
  expect((await saved).ok()).toBeTruthy()
  await expect(status).toHaveText('In progress')
  await expect(notice).toHaveCount(0)
  await expect(status).toBeInViewport()
  await expect(drawer.getByRole('heading', { name: 'Properties', exact: true })).toBeInViewport()
})
