import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['eudr', 'customers'],
}

const PRODUCT_MAPPINGS_PATH = '/api/eudr/product-mappings'
const EVIDENCE_SUBMISSIONS_PATH = '/api/eudr/evidence-submissions'
const PLOTS_PATH = '/api/eudr/plots'
const DASHBOARD_PATH = '/api/eudr/dashboard/widgets/compliance-overview'
const CUSTOMERS_COMPANIES_PATH = '/api/customers/companies'

type IncompleteSubmissionQueueItem = {
  id?: string
  label?: string | null
  completeness?: number
  url?: string
}

type ComplianceOverviewResponse = {
  mappingsInScope?: number
  plots?: {
    active?: number
    withWarnings?: number
  }
  queues?: {
    incompleteSubmissions?: IncompleteSubmissionQueueItem[]
  }
}

function polygonGeometry(): Record<string, unknown> {
  return {
    type: 'Polygon',
    coordinates: [[
      [-3.9921644, 5.1189651],
      [-3.9831442, 5.1189651],
      [-3.9831442, 5.1279483],
      [-3.9921644, 5.1279483],
      [-3.9921644, 5.1189651],
    ]],
  }
}

function parseFirstNumber(text: string): number | null {
  const match = text.replace(/\u00a0/g, ' ').replace(/,/g, '').match(/\d+(?:\.\d+)?/)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

async function createProductMapping(
  request: APIRequestContext,
  token: string,
  stamp: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', PRODUCT_MAPPINGS_PATH, {
    token,
    data: {
      productId: randomUUID(),
      commodity: 'coffee',
      hsCode: '090111',
      productSnapshot: { name: `TC-EUDR-011 Product ${stamp}`, sku: `TC-EUDR-011-${stamp}` },
      isInScope: true,
    },
  })
  expect(response.status(), `create product mapping failed: ${response.status()}`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, 'Product mapping create response should include id')
}

async function createPlot(
  request: APIRequestContext,
  token: string,
  supplierEntityId: string,
  stamp: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', PLOTS_PATH, {
    token,
    data: {
      supplierEntityId,
      name: `TC-EUDR-011 Plot ${stamp}`,
      commodity: 'coffee',
      originCountry: 'BR',
      plotType: 'polygon',
      geometry: polygonGeometry(),
    },
  })
  expect(response.status(), `create plot failed: ${response.status()}`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, 'Plot create response should include id')
}

async function createIncompleteSubmission(
  request: APIRequestContext,
  token: string,
  supplierEntityId: string,
  supplierDisplayName: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', EVIDENCE_SUBMISSIONS_PATH, {
    token,
    data: {
      supplierEntityId,
      commodity: 'coffee',
      supplierSnapshot: { displayName: supplierDisplayName },
      harvestFrom: '2020-06-01',
      harvestTo: '2020-11-30',
    },
  })
  expect(response.status(), `create evidence submission failed: ${response.status()}`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, 'Evidence submission create response should include id')
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

async function readKpiValue(page: Page, href: string): Promise<number> {
  const kpiCard = page.locator(`a[href="${href}"]`).filter({ hasText: /\d/ }).first()
  await expect(kpiCard, `KPI card linking to ${href} should render`).toBeVisible({ timeout: 15_000 })
  const value = parseFirstNumber(await kpiCard.innerText())
  expect(value, `KPI card linking to ${href} should render a numeric value`).not.toBeNull()
  return value ?? 0
}

/**
 * TC-EUDR-011: Compliance cockpit at /backend/eudr.
 *
 * Seeds an in-scope product mapping, an active plot, and an incomplete
 * evidence submission (with a pre-2021 harvest window) via API, then asserts
 * the submission detail response carries the `harvest_before_cutoff` warning,
 * the cockpit KPI cards render live counts, the incomplete-submissions queue
 * card lists the created submission by supplier name, and the queue row
 * navigates to the submission detail page. Inline API assertion covers
 * `GET /api/eudr/dashboard/widgets/compliance-overview` queues content.
 */
test.describe('TC-EUDR-011: Compliance cockpit', () => {
  test('renders KPI cards and incomplete-submissions queue linking to the submission detail', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${randomUUID()}`
    const supplierName = `TC-EUDR-011 Supplier ${stamp}`
    let supplierId: string | null = null
    let mappingId: string | null = null
    let plotId: string | null = null
    let submissionId: string | null = null

    try {
      supplierId = await createCompanyFixture(request, token, supplierName)
      mappingId = await createProductMapping(request, token, stamp)
      plotId = await createPlot(request, token, supplierId, stamp)
      submissionId = await createIncompleteSubmission(request, token, supplierId, supplierName)

      const submissionDetailResponse = await apiRequest(
        request,
        'GET',
        `${EVIDENCE_SUBMISSIONS_PATH}?id=${encodeURIComponent(submissionId)}`,
        { token },
      )
      expect(submissionDetailResponse.status(), `submission detail failed: ${submissionDetailResponse.status()}`).toBe(200)
      const submissionDetailBody = await readJsonSafe<{ items?: Array<{ id?: string; warnings?: string[] }> }>(submissionDetailResponse)
      const submissionDetail = (submissionDetailBody?.items ?? []).find((item) => item.id === submissionId)
      expect(submissionDetail, 'detail response should return the created submission').toBeTruthy()
      expect(
        submissionDetail?.warnings ?? [],
        'pre-2021 harvest window should carry the harvest_before_cutoff warning',
      ).toContain('harvest_before_cutoff')

      const overviewResponse = await apiRequest(request, 'GET', DASHBOARD_PATH, { token })
      expect(overviewResponse.status(), `compliance overview failed: ${overviewResponse.status()}`).toBe(200)
      const overview = await readJsonSafe<ComplianceOverviewResponse>(overviewResponse)
      expect(overview?.mappingsInScope ?? 0, 'overview should count in-scope mappings').toBeGreaterThanOrEqual(1)
      expect(overview?.plots?.active ?? 0, 'overview should count active plots').toBeGreaterThanOrEqual(1)
      const incompleteQueue = overview?.queues?.incompleteSubmissions
      expect(Array.isArray(incompleteQueue), 'admin overview should expose the incomplete-submissions queue').toBe(true)
      const queueEntry = (incompleteQueue ?? []).find((item) => item.id === submissionId)
      expect(
        queueEntry,
        'queues.incompleteSubmissions should contain the created submission id',
      ).toBeTruthy()
      expect(queueEntry?.label).toBe(supplierName)
      expect(queueEntry?.completeness ?? 100).toBeLessThan(100)
      expect(queueEntry?.url).toBe(`/backend/eudr/evidence-submissions/${submissionId}`)

      await login(page, 'admin')
      await page.goto('/backend/eudr', { waitUntil: 'domcontentloaded' })

      const mappingsKpiValue = await readKpiValue(page, '/backend/eudr/product-mappings')
      expect(mappingsKpiValue, 'in-scope products KPI should be at least 1').toBeGreaterThanOrEqual(1)
      const plotsKpiValue = await readKpiValue(page, '/backend/eudr/plots')
      expect(plotsKpiValue, 'active plots KPI should be at least 1').toBeGreaterThanOrEqual(1)

      const queueRow = page.locator(`a[href="/backend/eudr/evidence-submissions/${submissionId}"]`).first()
      await expect(queueRow, 'incomplete-submissions queue should list the created submission').toBeVisible({ timeout: 15_000 })
      await expect(queueRow, 'queue row should show the supplier name').toContainText(supplierName)
      await expectNoErrorState(page)

      await queueRow.click()
      await page.waitForURL(
        (url) => url.pathname.endsWith(`/backend/eudr/evidence-submissions/${submissionId}`),
        { timeout: 30_000 },
      )
      await expect(page.locator('[data-crud-field-id="originCountry"]').first()).toBeVisible({ timeout: 15_000 })
      await expectNoErrorState(page, 'Could not load evidence submission.')
    } finally {
      await deleteByCrudPath(request, token, EVIDENCE_SUBMISSIONS_PATH, submissionId)
      await deleteByCrudPath(request, token, PLOTS_PATH, plotId)
      await deleteByCrudPath(request, token, PRODUCT_MAPPINGS_PATH, mappingId)
      await deleteEntityIfExists(request, token, CUSTOMERS_COMPANIES_PATH, supplierId)
    }
  })
})
