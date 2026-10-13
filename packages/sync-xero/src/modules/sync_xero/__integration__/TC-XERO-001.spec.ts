import { expect, test, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { authorizeXero, isXeroTestFakesAvailable, resetXeroFakes, seedXeroFakes, startXeroFakes } from './helpers/xeroTestFakes'

const TAB_PATH = '/backend/integrations/sync_xero?tab=xero'
const DEMO = { tenantId: 'a1b2c3d4-0000-4000-8000-0000000000a1', connectionId: 'c1c1c1c1-0000-4000-8000-0000000000c1', name: 'Demo Company (Global)' }
const SECOND = { tenantId: 'b2b2b2b2-0000-4000-8000-0000000000b2', connectionId: 'c2c2c2c2-0000-4000-8000-0000000000c2', name: 'Second Ltd' }

async function expectTabState(page: Page, state: string): Promise<void> {
  await expect(page.getByTestId('sync-xero-tab')).toHaveAttribute('data-state', state, { timeout: 30_000 })
}

/**
 * TC-XERO-001: a consent round with two Organisations leaves the Account pending, the picker saves
 * one, and Disconnect warns about the other Organisation before ending the connection.
 * The save creates the hourly xero.contacts schedule.
 * Paths: initiate, callback, organisations, PUT organisation, connection, disconnect, the Xero tab.
 */
test.describe('TC-XERO-001: Connect with two Organisations, choose one, then Disconnect', () => {
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

  test('the admin connects, picks the second Organisation and disconnects', async ({ page, request }) => {
    const fakes = await startXeroFakes(request, token)
    await seedXeroFakes(request, token, { organisations: [DEMO, SECOND] })
    await authorizeXero(page, request, token, fakes.authorizationEndpoint)

    await login(page, 'admin')
    await page.goto(TAB_PATH, { waitUntil: 'domcontentloaded' })
    await expectTabState(page, 'not_connected')
    await expect(page.getByText('Test mode: this organization talks to the Xero test fakes, not to Xero.')).toBeVisible()

    await page.getByRole('button', { name: 'Connect to Xero' }).click()
    await page.waitForURL(/\/backend\/integrations\/sync_xero/, { timeout: 30_000 })
    await expectTabState(page, 'account_pending')
    await expect(page).not.toHaveURL(/xeroResult=/)

    await page.getByRole('button', { name: 'Choose Organisation' }).click()
    const picker = page.getByTestId('sync-xero-organisation-picker')
    await picker.getByLabel('Second Ltd').click()
    await picker.getByRole('button', { name: 'Save' }).click()
    await expectTabState(page, 'connected')
    await expect(page.getByText('Connected to the Xero Organisation Second Ltd.')).toBeVisible()
    await expect(page.getByTestId('sync-xero-schedules').getByText('Every 1h')).toBeVisible()

    await page.getByRole('button', { name: 'Disconnect' }).click()
    const dialog = page.getByTestId('sync-xero-disconnect-dialog')
    await expect(dialog.getByText('This connection also covers: Demo Company (Global). Revoking it may end their connection too.')).toBeVisible()
    await dialog.getByRole('button', { name: 'Disconnect' }).click()
    await expectTabState(page, 'not_connected')
    await expect(page.getByText('Not connected to Xero yet.')).toBeVisible()
  })
})
