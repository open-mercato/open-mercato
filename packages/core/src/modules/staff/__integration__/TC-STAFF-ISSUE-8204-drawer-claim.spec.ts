import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { Cleanup, addProjectMember, createStaffPerson, loginStaffInBrowser, type StaffPerson } from './support/fixtures'
import { createIssue8204DrawerFixture, expectIssue8204NoticeInView } from './helpers/issue8204Visibility'

const cleanup = new Cleanup()
let request: APIRequestContext
let fixture: Awaited<ReturnType<typeof createIssue8204DrawerFixture>>
let peer: StaffPerson

test.beforeAll(async ({ playwright, baseURL }) => {
  request = await playwright.request.newContext({ baseURL })
  const token = await getAuthToken(request, 'admin')
  fixture = await createIssue8204DrawerFixture(request, token, cleanup)
  peer = await createStaffPerson(request, token, cleanup, 'issue8204-peer', ['admin'])
  await addProjectMember(request, token, fixture.project.id, peer.staffMemberId, { isAssigner: true })
})

test.afterAll(async () => {
  await cleanup.run()
  await request?.dispose()
})

test('a real claim race reveals the specific notice from the bottom of the drawer', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 600 })
  await loginStaffInBrowser(page, fixture.actor)
  await page.goto(`/backend/staff/time-tracking/projects/${fixture.project.id}/board?task=${fixture.taskId}`)
  const drawer = page.getByRole('dialog', { name: fixture.title, exact: true })
  const claimPath = `/api/staff/timesheets/tasks/${fixture.taskId}/claim`
  await page.route(`**${claimPath}`, async (route) => {
    const competing = await apiRequest(request, 'POST', claimPath, { token: peer.token })
    expect(competing.status()).toBe(200)
    await route.continue()
  }, { times: 1 })
  const rejected = page.waitForResponse((response) => new URL(response.url()).pathname === claimPath)
  await drawer.getByRole('button', { name: 'Claim', exact: true }).click()
  expect((await rejected).status()).toBe(409)
  const notice = drawer.getByTestId('task-drawer-notice')
  await expect(notice).toHaveText('Someone else already took this task.')
  await expectIssue8204NoticeInView(notice, drawer)
  await testInfo.attach('claim-race-notice-visible', { body: await page.screenshot(), contentType: 'image/png' })
  await expect(drawer.getByRole('combobox', { name: 'Assignee', exact: true })).toHaveText(peer.displayName)
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
})
