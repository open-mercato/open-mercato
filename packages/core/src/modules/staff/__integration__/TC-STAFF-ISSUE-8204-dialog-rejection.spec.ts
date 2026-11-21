import { expect, test, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createStaffTeamMemberFixture, deleteStaffEntityIfExists } from '@open-mercato/core/helpers/integration/staffFixtures'

let request: APIRequestContext
let token: string
let memberId: string | null = null
let jobId: string | null = null

test.beforeAll(async ({ playwright, baseURL }) => {
  request = await playwright.request.newContext({ baseURL })
  token = await getAuthToken(request, 'admin')
})

test.afterAll(async () => {
  try {
    await deleteStaffEntityIfExists(request, token, '/api/staff/job-histories', jobId)
  } finally {
    try {
      await deleteStaffEntityIfExists(request, token, '/api/staff/team-members', memberId)
    } finally {
      await request?.dispose()
    }
  }
})

test('embedded job-history form reveals the server rejection and allows a successful keyboard retry', async ({ page }, testInfo) => {
  try {
    memberId = await createStaffTeamMemberFixture(request, token, { displayName: `QA issue 8204 dialog ${Date.now()}` })
    const created = await apiRequest(request, 'POST', '/api/staff/job-histories', {
      token,
      data: { entityId: memberId, name: 'Original job', startDate: '2020-01-01' },
    })
    expect(created.status()).toBe(201)
    jobId = ((await created.json()) as { id: string }).id
    await page.setViewportSize({ width: 1280, height: 400 })
    await login(page, 'admin')
    await page.goto(`/backend/staff/team-members/${memberId}`)
    await page.getByRole('tab', { name: 'Job history', exact: true }).click()
    await page.getByRole('button', { name: 'Edit job', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit job', exact: true })
    const name = dialog.locator('[data-crud-field-id="name"]').getByRole('textbox')
    await name.fill('Updated job')
    const reason = 'This job update was rejected by the server.'
    await page.route('**/api/staff/job-histories', async (route) => {
      if (route.request().method() !== 'PUT') return route.continue()
      await route.fulfill({ status: 422, json: { error: reason } })
    })
    await dialog.getByRole('button', { name: 'Update job', exact: true }).click()
    const summary = dialog.locator('[data-crud-form-error]')
    await expect(summary.getByRole('alert')).toHaveText(reason)
    await expect(summary).toBeFocused()
    const container = (await dialog.boundingBox())!
    const message = (await summary.boundingBox())!
    expect(message.y).toBeGreaterThanOrEqual(container.y)
    expect(message.y + message.height).toBeLessThanOrEqual(container.y + container.height)
    expect(message.y).toBeGreaterThanOrEqual(0)
    expect(message.y + message.height).toBeLessThanOrEqual(400)
    await testInfo.attach('dialog-rejection-visible', { body: await page.screenshot(), contentType: 'image/png' })

    await page.unroute('**/api/staff/job-histories')
    const saved = page.waitForResponse((response) => response.request().method() === 'PUT'
      && new URL(response.url()).pathname === '/api/staff/job-histories')
    await name.press('Control+Enter')
    expect((await saved).ok()).toBeTruthy()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByText('Updated job', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Edit job', exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  } finally {
    await page.unroute('**/api/staff/job-histories').catch(() => undefined)
  }
})
