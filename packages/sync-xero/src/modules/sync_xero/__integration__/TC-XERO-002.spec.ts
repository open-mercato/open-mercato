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

async function connectThroughXero(page: Page, buttonName: 'Connect to Xero' | 'Reconnect'): Promise<void> {
  await page.getByRole('button', { name: buttonName }).click()
  await page.waitForURL(/\/backend\/integrations\/sync_xero\?.*xeroResult=/, { timeout: 30_000 })
  await expect(page).not.toHaveURL(/xeroResult=/, { timeout: 30_000 })
}

/**
 * TC-XERO-002: automatic Organisation selection. A single-Organisation consent selects it, a
 * Reconnect re-selects the previous Organisation, a consent with no Organisation leaves the
 * Account pending, and choosing a different Organisation asks for a confirmation.
 */
test.describe('TC-XERO-002: automatic Organisation selection and the change confirmation', () => {
  test.describe.configure({ timeout: 240_000 })

  let token = ''

  test.beforeEach(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
    test.skip(!(await isXeroTestFakesAvailable(request, token)), 'OM_ENABLE_TEST_OAUTH_GRANTS is off in the app under test')
    await resetXeroFakes(request, token)
  })

  test.afterEach(async ({ request }) => {
    if (token) await resetXeroFakes(request, token).catch(() => undefined)
  })

  test('select, re-select, leave pending, and confirm a change', async ({ page, request }) => {
    const fakes = await startXeroFakes(request, token)
    await seedXeroFakes(request, token, { organisations: [DEMO] })
    await authorizeXero(page, request, token, fakes.authorizationEndpoint)
    await login(page, 'admin')
    await page.goto(TAB_PATH, { waitUntil: 'domcontentloaded' })
    await expectTabState(page, 'not_connected')

    await connectThroughXero(page, 'Connect to Xero')
    await expectTabState(page, 'connected')
    await expect(page.getByText('Connected to the Xero Organisation Demo Company (Global).')).toBeVisible()

    await connectThroughXero(page, 'Reconnect')
    await expectTabState(page, 'connected')
    await expect(page.getByText('Connected to the Xero Organisation Demo Company (Global).')).toBeVisible()

    await seedXeroFakes(request, token, { organisations: [] })
    await connectThroughXero(page, 'Reconnect')
    await expectTabState(page, 'account_pending')
    await page.getByRole('button', { name: 'Choose Organisation' }).click()
    const picker = page.getByTestId('sync-xero-organisation-picker')
    await expect(picker.getByText('No Xero Organisation was authorised. Reconnect and select one in Xero.')).toBeVisible()
    await picker.getByRole('button', { name: 'Cancel' }).click()

    await seedXeroFakes(request, token, { organisations: [DEMO, SECOND] })
    await page.getByRole('button', { name: 'Choose Organisation' }).click()
    await picker.getByLabel('Second Ltd').click()
    await picker.getByRole('button', { name: 'Save' }).click()
    await expect(picker.getByText('Sync with Second Ltd instead?')).toBeVisible()
    await expect(picker.getByText('0 companies were imported from Demo Company (Global).')).toBeVisible()
    await picker.getByRole('button', { name: 'Continue' }).click()
    await expectTabState(page, 'connected')
    await expect(page.getByText('Connected to the Xero Organisation Second Ltd.')).toBeVisible()
  })
})
