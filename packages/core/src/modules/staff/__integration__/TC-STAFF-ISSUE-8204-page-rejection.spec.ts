import { expect, test, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteStaffEntityIfExists } from '@open-mercato/core/helpers/integration/staffFixtures'

let request: APIRequestContext
let token: string
let memberId: string | null = null

test.beforeAll(async ({ playwright, baseURL }) => {
  request = await playwright.request.newContext({ baseURL })
  token = await getAuthToken(request, 'admin')
})

test.afterAll(async () => {
  try {
    await deleteStaffEntityIfExists(request, token, '/api/staff/team-members', memberId)
  } finally {
    await request?.dispose()
  }
})

test('long CrudForm reveals required and repeated oversized server errors, then saves successfully', async ({ page }, testInfo) => {
  try {
    await page.setViewportSize({ width: 1280, height: 600 })
    await login(page, 'admin')
    await page.goto('/backend/staff/team-members/create')
    const nameField = page.locator('[data-crud-field-id="displayName"]')
    const footerSubmit = page.getByRole('button', { name: 'Create', exact: true }).last()
    const summary = page.locator('[data-crud-form-error]')
    await footerSubmit.click()
    await expect(summary.getByRole('alert')).toHaveText('This field is required')
    await expect(summary).toBeFocused()
    await expect(nameField.getByText('This field is required', { exact: true })).toBeVisible()

    const name = `QA issue 8204 ${Date.now()}`
    await nameField.getByRole('textbox').fill(name)
    const reason = `Saving this team member was rejected. ${'Check the submitted record before retrying. '.repeat(180)}`.trim()
    await page.route('**/api/staff/team-members', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      await route.fulfill({ status: 422, json: { error: reason } })
    })
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await footerSubmit.scrollIntoViewIfNeeded()
      if (attempt > 0) {
        expect((await summary.boundingBox())!.y).toBeLessThan(0)
      }
      const rejected = page.waitForResponse((response) => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/staff/team-members')
      await footerSubmit.click()
      expect((await rejected).status()).toBe(422)
      await expect(summary.getByRole('alert')).toHaveText(reason)
      await expect(summary).toBeFocused()
      await expect.poll(async () => (await summary.boundingBox())!.y).toBeGreaterThanOrEqual(0)
      const bounds = (await summary.boundingBox())!
      expect(bounds.y).toBeLessThan(600)
      expect(bounds.height).toBeGreaterThan(600)
    }
    await testInfo.attach('oversized-rejection-visible', { body: await page.screenshot(), contentType: 'image/png' })

    await page.unroute('**/api/staff/team-members')
    const saved = page.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/staff/team-members')
    await footerSubmit.click()
    const response = await saved
    expect(response.status()).toBe(201)
    memberId = ((await response.json()) as { id: string }).id
    await expect(page).toHaveURL(new RegExp(`/backend/staff/team-members/${memberId}(?:\\?|$)`))
    await expect(summary).toHaveCount(0)
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  } finally {
    await page.unroute('**/api/staff/team-members').catch(() => undefined)
  }
})
