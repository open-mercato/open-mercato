import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { authorizeXero, isXeroTestFakesAvailable, resetXeroFakes, seedXeroFakes, startXeroFakes } from './helpers/xeroTestFakes'

const TAB_PATH = '/backend/integrations/sync_xero?tab=xero'
const DEMO = { tenantId: 'a1b2c3d4-0000-4000-8000-0000000000a1', connectionId: 'c1c1c1c1-0000-4000-8000-0000000000c1', name: 'Demo Company (Global)' }

async function expectTabState(page: Page, state: string): Promise<void> {
  await expect(page.getByTestId('sync-xero-tab')).toHaveAttribute('data-state', state, { timeout: 30_000 })
}

async function deleteXeroSchedules(request: APIRequestContext, token: string): Promise<void> {
  const listed = await apiRequest(request, 'GET', '/api/data_sync/schedules?integrationId=sync_xero&page=1&pageSize=20', { token })
  expect(listed.status()).toBe(200)
  const { items } = (await listed.json()) as { items: Array<{ id: string }> }
  expect(items.length).toBeGreaterThan(0)
  for (const item of items) {
    const deleted = await apiRequest(request, 'DELETE', `/api/data_sync/schedules/${item.id}`, { token })
    expect(deleted.status(), await deleted.text()).toBeLessThan(300)
  }
}

/**
 * TC-XERO-004: the default schedule and the credential removal. A deleted schedule shows as
 * missing with a keep-alive warning, "Create default schedule" restores it, and Disconnect with
 * "Also remove the Client ID and Secret" leaves the tab not configured. Paths: schedules, the tab.
 */
test.describe('TC-XERO-004: default schedule recovery and Disconnect with credential removal', () => {
  test.describe.configure({ timeout: 180_000 })

  let token = ''

  test.beforeEach(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
    test.skip(!(await isXeroTestFakesAvailable(request, token)), 'OM_ENABLE_TEST_OAUTH_GRANTS is off in the app under test')
    await resetXeroFakes(request, token)
  })

  test.afterEach(async ({ request }) => {
    if (token) await resetXeroFakes(request, token).catch(() => undefined)
  })

  test('restores a deleted schedule and removes the Client ID and Secret on Disconnect', async ({ page, request }) => {
    const fakes = await startXeroFakes(request, token)
    await seedXeroFakes(request, token, { organisations: [DEMO] })
    await authorizeXero(page, request, token, fakes.authorizationEndpoint)
    await login(page, 'admin')
    await page.goto(TAB_PATH, { waitUntil: 'domcontentloaded' })
    await expectTabState(page, 'not_connected')

    await page.getByRole('button', { name: 'Connect to Xero' }).click()
    await page.waitForURL(/xeroResult=/, { timeout: 30_000 })
    await expect(page).not.toHaveURL(/xeroResult=/, { timeout: 30_000 })
    await expectTabState(page, 'connected')
    const schedules = page.getByTestId('sync-xero-schedules')
    await expect(schedules.getByText('Every 1h')).toBeVisible()

    await deleteXeroSchedules(request, token)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expectTabState(page, 'connected')
    await expect(schedules.getByText('No schedule')).toBeVisible()
    await expect(schedules.getByRole('alert').first()).toBeVisible()
    await schedules.getByRole('button', { name: 'Create default schedule' }).click()
    await expect(schedules.getByText('Every 1h')).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Disconnect' }).click()
    const dialog = page.getByTestId('sync-xero-disconnect-dialog')
    await dialog.getByLabel('Also remove the Client ID and Secret').click()
    await dialog.getByRole('button', { name: 'Disconnect' }).click()
    await expectTabState(page, 'not_configured')
    await expect(page.getByText('Register this redirect URI in a Xero app, then add its Client ID and Secret.')).toBeVisible()
  })
})
