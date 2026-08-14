import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createTestCustomer, type TestCustomerFixture } from './fixtures'

export const integrationMeta = {
  dependsOnModules: ['customers', 'currencies'],
}

/**
 * TC-TT-004 — Create a project (screen 4).
 *
 * Source: `.ai/specs/2026-08-12-time-tracking-consulting-suite.md`
 *   § Testing Coverage → Integration → "Create project with customer, rate, currency,
 *   budget; code auto-derives and dedupes; a sole-trader customer works as well as a
 *   company".
 *   D-9 — `customer_id` points at `customers.customer_entities`, so a client may be a
 *   company *or* a sole trader through one code path, and a customer is mandatory (US-B1).
 *   D-10 — the required-and-unique `code` is auto-derived from the name and editable
 *   behind an explicit affordance.
 *
 * Every assertion about a saved value is made by **reading the record back** through
 * `GET /api/staff/timesheets/time-projects?ids=…`, not by trusting the redirect. T2.9
 * existed precisely because the form rendered fields the write path dropped, so a
 * create-only assertion would have passed straight through that bug.
 *
 * `currencies` is declared as a dependency because the currency picker is populated
 * from `GET /api/currencies/currencies/options`; without that module the field has
 * nothing to choose.
 *
 * Persona: `admin` (`staff.*` ⊇ `staff.timesheets.projects.manage`) — the create page
 * is guarded by that feature.
 */

const TIME_PROJECTS_PATH = '/api/staff/timesheets/time-projects'
const PEOPLE_PATH = '/api/customers/people'
const CREATE_PAGE = '/backend/staff/time-tracking/projects/create'
const PROJECT_URL_PATTERN = /\/backend\/staff\/time-tracking\/projects\/([0-9a-f-]{36})$/i

type TimeProjectRecord = {
  id?: string
  name?: string
  code?: string
  customer_id?: string | null
  customer_snapshot?: Record<string, unknown> | null
  hourly_rate?: string | number | null
  currency_code?: string | null
  budget_kind?: string | null
  budget_value?: string | number | null
  budget_warn_at_percent?: number | null
}

async function readProject(
  request: APIRequestContext,
  token: string,
  projectId: string,
): Promise<TimeProjectRecord> {
  const response = await apiRequest(
    request,
    'GET',
    `${TIME_PROJECTS_PATH}?ids=${encodeURIComponent(projectId)}&pageSize=1`,
    { token },
  )
  expect(response.ok(), `GET ${TIME_PROJECTS_PATH} should return the created project: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<{ items?: TimeProjectRecord[] }>(response)
  const record = body?.items?.[0]
  expect(record, 'The created project should be readable through the list route').toBeTruthy()
  return record as TimeProjectRecord
}

async function pickCustomer(page: Page, customerName: string): Promise<void> {
  const customerField = page.locator('[data-crud-field-id="customerId"]')
  await customerField.getByRole('combobox').fill(customerName)
  await page.getByRole('option', { name: customerName }).first().click()
}

function projectIdFromUrl(page: Page): string {
  const match = page.url().match(PROJECT_URL_PATTERN)
  expect(match?.[1], `Saving should land on the project detail route; got ${page.url()}`).toBeTruthy()
  return match![1]
}

test.describe('TC-TT-004: Create a time tracking project', () => {
  test('persists customer, code, rate, currency and budget, and lets the derived code be edited', async ({ page, request }) => {
    test.setTimeout(120_000)

    const stamp = String(Date.now()).slice(-9)
    // `QATT4 <9 digits>` slugifies to `QATT4-<9 digits>` (15 chars), inside the
    // 19-character word budget, so the derived code is exact and collision-free.
    const projectName = `QATT4 ${stamp}`
    const derivedCode = `QATT4-${stamp}`
    const manualCode = `QATT4M-${stamp}`
    const customerName = `QATT4 Company ${stamp}`

    const adminToken = await getAuthToken(request, 'admin')
    let customer: TestCustomerFixture | null = null
    let createdProjectId: string | null = null

    try {
      customer = await createTestCustomer(request, adminToken, { displayName: customerName })

      // The currency list is tenant data, so the spec reads what is actually there
      // instead of assuming a seeded PLN/EUR.
      const currencyResponse = await apiRequest(request, 'GET', '/api/currencies/currencies/options?limit=100', {
        token: adminToken,
      })
      expect(currencyResponse.ok(), `GET currency options should succeed: ${currencyResponse.status()}`).toBeTruthy()
      const currencyBody = await readJsonSafe<{ items?: Array<{ value?: string; label?: string }> }>(currencyResponse)
      const currency = (currencyBody?.items ?? []).find(
        (item) => typeof item.value === 'string' && item.value.length > 0 && typeof item.label === 'string',
      )
      expect(currency, 'The tenant needs at least one currency for the project currency picker').toBeTruthy()

      await login(page, 'admin')
      await page.goto(CREATE_PAGE)

      await expect(page.getByRole('heading', { name: 'New project' })).toBeVisible({ timeout: 30_000 })

      const nameField = page.locator('[data-crud-field-id="name"]')
      await nameField.getByRole('textbox').fill(projectName)

      // D-10: the code is derived from the name and shown read-only…
      const codeField = page.locator('[data-crud-field-id="code"]')
      await expect(codeField).toContainText(derivedCode, { timeout: 30_000 })
      await expect(codeField).toContainText('Derived from the project name')

      // …but stays editable behind an explicit affordance.
      await codeField.getByRole('button', { name: 'Edit code' }).click()
      const codeInput = codeField.getByRole('textbox')
      await expect(codeInput).toHaveValue(derivedCode)
      await codeInput.fill(manualCode)
      await codeField.getByRole('button', { name: 'Done' }).click()
      await expect(codeField).toContainText(manualCode)

      await pickCustomer(page, customerName)

      await page.locator('[data-crud-field-id="hourlyRate"]').getByRole('textbox').fill('320')

      const currencyField = page.locator('[data-crud-field-id="currencyCode"]')
      await currencyField.getByRole('combobox').click()
      await page.getByRole('option', { name: currency!.label as string }).first().click()

      // Budget card (screen 4, §9 scope).
      await page.getByRole('switch', { name: 'Track the limit' }).click()
      await page.getByLabel('Limit', { exact: true }).fill('125')

      await page.getByRole('button', { name: 'Create', exact: true }).click()

      await page.waitForURL(PROJECT_URL_PATTERN, { timeout: 60_000 })
      createdProjectId = projectIdFromUrl(page)

      // The point of this test: read the record back and prove every field landed.
      const saved = await readProject(request, adminToken, createdProjectId)
      expect(saved.name).toBe(projectName)
      expect(saved.code).toBe(manualCode.toUpperCase())
      expect(saved.customer_id).toBe(customer.id)
      expect(saved.customer_snapshot?.name).toBe(customerName)
      expect(Number(saved.hourly_rate)).toBe(320)
      expect(saved.currency_code).toBe(currency!.value)
      expect(saved.budget_kind).toBe('hours')
      expect(Number(saved.budget_value)).toBe(125)
      expect(saved.budget_warn_at_percent).toBe(80)
    } finally {
      if (createdProjectId) {
        await apiRequest(request, 'DELETE', `${TIME_PROJECTS_PATH}?id=${encodeURIComponent(createdProjectId)}`, {
          token: adminToken,
        }).catch(() => {})
      }
      if (customer) await customer.cleanup()
    }
  })

  test('requires a customer (D-9) and accepts a sole trader as readily as a company', async ({ page, request }) => {
    test.setTimeout(120_000)

    const stamp = String(Date.now()).slice(-9)
    const projectName = `QATT4S ${stamp}`
    const soleTraderName = `QATT4 Sole Trader ${stamp}`

    const adminToken = await getAuthToken(request, 'admin')
    let soleTraderId: string | null = null
    let createdProjectId: string | null = null

    try {
      // D-9: the FK targets the customers supertype, so a person is a valid customer.
      soleTraderId = await createPersonFixture(request, adminToken, {
        firstName: 'QATT4',
        lastName: `Sole ${stamp}`,
        displayName: soleTraderName,
      })

      await login(page, 'admin')
      await page.goto(CREATE_PAGE)
      await expect(page.getByRole('heading', { name: 'New project' })).toBeVisible({ timeout: 30_000 })

      await page.locator('[data-crud-field-id="name"]').getByRole('textbox').fill(projectName)

      // US-B1 / D-9 — a project cannot be saved without a customer.
      await expect(page.locator('[data-crud-field-id="customerId"]')).toContainText(
        'Time is organised per customer',
      )
      await page.getByRole('button', { name: 'Create', exact: true }).click()

      await expect(page).toHaveURL(new RegExp(`${CREATE_PAGE}$`))
      await expect(page.locator('[data-crud-field-id="customerId"]')).toContainText(/required/i)

      // The same form, now with a sole trader, saves and persists that customer.
      await pickCustomer(page, soleTraderName)
      await page.getByRole('button', { name: 'Create', exact: true }).click()

      await page.waitForURL(PROJECT_URL_PATTERN, { timeout: 60_000 })
      createdProjectId = projectIdFromUrl(page)

      const saved = await readProject(request, adminToken, createdProjectId)
      expect(saved.name).toBe(projectName)
      expect(saved.customer_id).toBe(soleTraderId)
      expect(saved.customer_snapshot?.name).toBe(soleTraderName)
      expect(saved.customer_snapshot?.kind).toBe('person')
    } finally {
      if (createdProjectId) {
        await apiRequest(request, 'DELETE', `${TIME_PROJECTS_PATH}?id=${encodeURIComponent(createdProjectId)}`, {
          token: adminToken,
        }).catch(() => {})
      }
      await deleteEntityIfExists(request, adminToken, PEOPLE_PATH, soleTraderId)
    }
  })
})
