import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['eudr', 'customers', 'catalog'],
}

const STATEMENTS_PATH = '/api/eudr/statements'
const EVIDENCE_SUBMISSIONS_PATH = '/api/eudr/evidence-submissions'
const RISK_ASSESSMENTS_PATH = '/api/eudr/risk-assessments'
const CUSTOMERS_COMPANIES_PATH = '/api/customers/companies'

function isoDaysAgo(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString()
}

function completeSubmissionFields(stamp: string): Record<string, unknown> {
  return {
    originCountry: 'BR',
    geolocation: { type: 'Point', coordinates: [-48.5, -21.2] },
    quantityKg: 1500,
    harvestFrom: isoDaysAgo(90),
    harvestTo: isoDaysAgo(30),
    producerName: `TC-EUDR-009 Producer ${stamp}`,
    attachmentIds: [randomUUID()],
  }
}

function smallPolygonText(): string {
  return JSON.stringify({
    type: 'Polygon',
    coordinates: [[
      [-3.9921644, 5.1189651],
      [-3.9831442, 5.1189651],
      [-3.9831442, 5.1279483],
      [-3.9921644, 5.1279483],
      [-3.9921644, 5.1189651],
    ]],
  })
}

async function expectNoErrorState(page: Page, loadError?: string): Promise<void> {
  await expect(
    page.getByRole('heading', {
      name: /Application error: a client-side exception has occurred|Something went wrong/i,
    }).first(),
  ).not.toBeVisible()
  if (loadError) {
    await expect(page.getByText(loadError, { exact: true })).not.toBeVisible()
  }
}

async function waitForBackendTable(page: Page): Promise<void> {
  await page.getByText('Loading data...', { exact: true }).first()
    .waitFor({ state: 'hidden', timeout: 10_000 })
    .catch(() => undefined)
}

async function expectActionVisible(page: Page, name: RegExp): Promise<void> {
  const link = page.getByRole('link', { name }).first()
  if (await link.isVisible().catch(() => false)) {
    await expect(link).toBeVisible()
    return
  }
  await expect(page.getByRole('button', { name }).first()).toBeVisible()
}

async function createStatement(
  request: APIRequestContext,
  token: string,
  title: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', STATEMENTS_PATH, {
    token,
    data: { title, commodity: 'coffee' },
  })
  expect(response.status(), `create statement failed: ${response.status()}`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, 'Statement create response should include id')
}

async function createSubmission(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', EVIDENCE_SUBMISSIONS_PATH, { token, data })
  expect(response.status(), `create evidence submission failed: ${response.status()}`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, 'Evidence submission create response should include id')
}

async function createRiskAssessment(
  request: APIRequestContext,
  token: string,
  statementId: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', RISK_ASSESSMENTS_PATH, {
    token,
    data: { statementId, criteria: {}, conclusion: 'negligible' },
  })
  expect(response.status(), `create risk assessment failed: ${response.status()}`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, 'Risk assessment create response should include id')
}

async function deleteByCrudPath(
  request: APIRequestContext,
  token: string | null,
  path: string,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  await apiRequest(request, 'DELETE', `${path}?id=${encodeURIComponent(id)}`, { token }).catch(() => undefined)
}

/**
 * TC-EUDR-009: Backend EUDR batch-2 UI smoke.
 */
test.describe('TC-EUDR-009: EUDR batch-2 UI smoke', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin')
  })

  test('renders plots list and create form with geometry preview', async ({ page }) => {
    await page.goto('/backend/eudr/plots', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Plots', level: 2 }).first()).toBeVisible()
    await waitForBackendTable(page)
    await expectActionVisible(page, /create/i)
    await expectActionVisible(page, /import/i)
    await expectNoErrorState(page, 'Could not load plots.')

    await page.goto('/backend/eudr/plots/create', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-crud-field-id="name"]').first()).toBeVisible()
    await expect(page.locator('[data-crud-field-id="originCountry"]').first()).toBeVisible()
    const geometryField = page.locator('[data-crud-field-id="geometry"]').first()
    await expect(geometryField).toBeVisible()
    // The create page is server-rendered, so retry the toggle until React has
    // hydrated and the click actually reveals the paste textarea.
    await expect(async () => {
      await geometryField.getByRole('button', { name: /paste json/i }).click()
      await expect(geometryField.locator('textarea').first()).toBeVisible({ timeout: 1500 })
    }).toPass({ timeout: 15_000 })
    await geometryField.locator('textarea').first().fill(smallPolygonText())
    await expect(
      page.locator('[class*="leaflet"], [data-testid*="map"], [data-testid="eudr-plot-map-preview"]').first(),
    ).toBeVisible()
    await expectNoErrorState(page)
  })

  test('renders evidence submission detail fields and statement risk lifecycle UI', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${randomUUID()}`
    let supplierId: string | null = null
    let submissionId: string | null = null
    let statementId: string | null = null
    let assessmentId: string | null = null

    try {
      supplierId = await createCompanyFixture(request, token, `TC-EUDR-009 Supplier ${stamp}`)
      statementId = await createStatement(request, token, `TC-EUDR-009 Statement ${stamp}`)
      submissionId = await createSubmission(request, token, {
        supplierEntityId: supplierId,
        commodity: 'coffee',
        statementId,
        ...completeSubmissionFields(stamp),
        status: 'verified',
      })

      await page.goto(`/backend/eudr/evidence-submissions/${encodeURIComponent(submissionId)}`, {
        waitUntil: 'domcontentloaded',
      })
      await expect(page.locator('[data-crud-field-id="plotIds"]').first()).toBeVisible()
      await expect(page.locator('[data-crud-field-id="originCountry"]').first()).toBeVisible()
      await page.getByRole('button', { name: /legacy geolocation/i }).first().click()
      await expect(page.locator('[data-crud-field-id="geolocation"]').first()).toBeVisible()
      await expect(page.locator('[data-crud-field-id="attachmentIds"]')).toHaveCount(0)
      await expectNoErrorState(page, 'Could not load evidence submission.')

      await page.goto(`/backend/eudr/statements/${encodeURIComponent(statementId)}`, {
        waitUntil: 'domcontentloaded',
      })
      await expect(page.getByRole('button', { name: /submit/i }).first()).toBeVisible()
      await expectActionVisible(page, /assess risk/i)
      await expectNoErrorState(page, 'Could not load statement.')

      assessmentId = await createRiskAssessment(request, token, statementId)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByText(/negligible/i).first()).toBeVisible()
      await expectNoErrorState(page, 'Could not load statement.')

      await page.goto('/backend/eudr/risk-assessments', { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: 'Risk assessments', level: 2 }).first()).toBeVisible()
      await waitForBackendTable(page)
      await expectNoErrorState(page, 'Could not load risk assessments.')

      await page.goto('/backend/eudr/statements', { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: 'Statements', level: 2 }).first()).toBeVisible()
      await waitForBackendTable(page)
      await expect(page.getByRole('columnheader', { name: /EUDR risk|Risk/i }).first()).toBeVisible()
      await expect(page.getByText(/negligible/i).first()).toBeVisible()
      await expectNoErrorState(page, 'Could not load statements.')
    } finally {
      await deleteByCrudPath(request, token, RISK_ASSESSMENTS_PATH, assessmentId)
      await deleteByCrudPath(request, token, EVIDENCE_SUBMISSIONS_PATH, submissionId)
      await deleteByCrudPath(request, token, STATEMENTS_PATH, statementId)
      await deleteEntityIfExists(request, token, CUSTOMERS_COMPANIES_PATH, supplierId)
    }
  })

  test('renders injected EUDR catalog products column', async ({ page }) => {
    await page.goto('/backend/catalog/products', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: /Products/i }).first()).toBeVisible()
    await waitForBackendTable(page)
    await expect(page.getByRole('columnheader', { name: /EUDR/i }).first()).toBeVisible()
    await expectNoErrorState(page, 'Could not load products.')
  })
})
