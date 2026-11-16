import { expect, test, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  restoreIntegration,
  saveCredentials,
  setIntegrationEnabled,
  snapshotIntegration,
  VALID_NIP,
  type IntegrationSnapshot,
} from './helpers/fixtures'

/**
 * TC-GUS-005: CRM company card (UI)
 *
 * - Switch off → no "Fetch data from GUS REGON" card on the company create form.
 * - Switch on + API key → card shown on the company create form, not on the person create form.
 * - "Fetch from GUS" fills empty Display name / Legal name.
 *
 * The lookup response is stubbed in the browser (`page.route`) with the
 * test-registry payload, so the test does not depend on GUS availability.
 * State and credentials are restored in `afterEach`; skips when a real key is configured.
 */

const COMPANY_NAME = 'GOOGLE POLAND SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ'

/** CrudForm labels are not bound to inputs; target the field wrapper by its id. */
function crudField(page: Page, fieldId: string) {
  return page.locator(`[data-crud-field-id="${fieldId}"]`).getByRole('textbox')
}

function gusCard(page: Page) {
  return page.getByRole('region', { name: 'Fetch data from GUS REGON' })
}

function stubLookup(page: Page) {
  return page.route('**/api/gus_regon/lookup?**', async (route) => {
    const company = {
      nip: VALID_NIP,
      regon: '140182840',
      name: COMPANY_NAME,
      street: 'ul. Test-Krucza',
      buildingNumber: '53',
      flatNumber: null,
      postalCode: '00-113',
      city: 'Warszawa',
      voivodeship: 'MAZOWIECKIE',
      county: 'm. st. Warszawa',
      commune: 'Śródmieście',
      type: 'P',
      endDate: null,
      country: 'PL',
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, company, candidates: [company] }) })
  })
}

test.describe('TC-GUS-005: GUS REGON card on CRM company forms', () => {
  let token: string | null = null
  let snapshot: IntegrationSnapshot | null = null

  test.afterEach(async ({ request }) => {
    if (token && snapshot) await restoreIntegration(request, token, snapshot)
    token = null
    snapshot = null
  })

  test('is opt-in, shown only on company forms, and fills empty fields', async ({ page, request }) => {
    const authToken = await getAuthToken(request, 'superadmin')
    const initial = await snapshotIntegration(request, authToken)
    test.skip(initial.credentials === null, 'Integration credentials cannot be read on this environment')
    test.skip(initial.apiKeyConfigured, 'A GUS API key is already configured on this environment')
    token = authToken
    snapshot = initial

    await saveCredentials(request, authToken, { environment: 'test', apiKey: 'abcde12345abcde12345', showOnCompanyForms: false })
    await setIntegrationEnabled(request, authToken, true)

    await login(page, 'superadmin')
    await page.goto('/backend/customers/companies/create')
    await expect(crudField(page, 'displayName')).toBeVisible()
    await expect(gusCard(page)).toHaveCount(0)

    await saveCredentials(request, authToken, { environment: 'test', apiKey: 'abcde12345abcde12345', showOnCompanyForms: true })
    await stubLookup(page)
    await page.goto('/backend/customers/people/create')
    await expect(crudField(page, 'firstName')).toBeVisible()
    await expect(gusCard(page)).toHaveCount(0)

    await page.goto('/backend/customers/companies/create')
    await expect(gusCard(page)).toBeVisible()
    await gusCard(page).getByLabel('NIP').fill(VALID_NIP)
    await gusCard(page).getByRole('button', { name: 'Fetch from GUS' }).click()
    await expect(gusCard(page).getByText('REGON 140182840')).toBeVisible()
    await expect(crudField(page, 'displayName')).toHaveValue(COMPANY_NAME)
    await expect(crudField(page, 'legalName')).toHaveValue(COMPANY_NAME)
  })
})
