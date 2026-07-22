import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { deleteUserAclInDb, setUserAclInDb } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['eudr', 'customers', 'catalog'],
}

const PRODUCT_MAPPINGS_PATH = '/api/eudr/product-mappings'
const PRODUCT_MAPPING_SUGGESTIONS_PATH = '/api/eudr/product-mappings/suggestions'
const PRODUCT_MAPPING_SUGGESTIONS_APPLY_PATH = '/api/eudr/product-mappings/suggestions/apply'
const STATEMENTS_PATH = '/api/eudr/statements'
const EVIDENCE_SUBMISSIONS_PATH = '/api/eudr/evidence-submissions'
const RISK_ASSESSMENTS_PATH = '/api/eudr/risk-assessments'
const PLOTS_PATH = '/api/eudr/plots'
const DASHBOARD_PATH = '/api/eudr/dashboard/widgets/compliance-overview'
const CATALOG_PRODUCTS_PATH = '/api/catalog/products'
const CUSTOMERS_COMPANIES_PATH = '/api/customers/companies'

type JsonRecord = Record<string, unknown>

type ListResponse<T> = {
  items?: T[]
}

type ProductMappingRow = {
  id: string
  productId?: string | null
  commodity?: string | null
}

type SuggestionRow = {
  productId?: string | null
  suggestedCommodity?: string | null
}

type CatalogProductRow = {
  id: string
  sku?: string | null
  _eudr?: {
    commodity?: string | null
  } | null
}

type ApplySuggestionsResponse = {
  created?: number
  failed?: Array<{ productId?: string; errorKey?: string; message?: string }>
  ids?: string[]
  createdIds?: string[]
}

type ExportJsonResponse = {
  riskAssessment?: unknown
  plots?: unknown[]
  lifecycle?: {
    retainUntil?: string | null
  }
}

type GeoJsonFeatureCollection = {
  type?: string
  features?: Array<{
    type?: string
    properties?: {
      plotId?: string
      supplierName?: string
    }
  }>
}

function isoDaysAgo(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString()
}

function isoDaysFromNow(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : null
}

function numberField(record: JsonRecord | null, key: string): number | null {
  const value = record?.[key]
  return typeof value === 'number' ? value : null
}

function extractItems<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  const record = asRecord(value)
  const items = record?.items
  return Array.isArray(items) ? items as T[] : []
}

function completeSubmissionFields(stamp: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    originCountry: 'BR',
    geolocation: { type: 'Point', coordinates: [-48.5, -21.2] },
    quantityKg: 1500,
    harvestFrom: isoDaysAgo(90),
    harvestTo: isoDaysAgo(30),
    producerName: `TC-EUDR-008 Producer ${stamp}`,
    attachmentIds: [randomUUID()],
    ...overrides,
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

async function createProductMapping(
  request: APIRequestContext,
  token: string,
  input: { productId?: string; stamp: string; isInScope?: boolean },
): Promise<string> {
  const response = await apiRequest(request, 'POST', PRODUCT_MAPPINGS_PATH, {
    token,
    data: {
      productId: input.productId ?? randomUUID(),
      commodity: 'coffee',
      hsCode: '090111',
      productSnapshot: { name: `TC-EUDR-008 Product ${input.stamp}`, sku: `TC-EUDR-008-${input.stamp}` },
      isInScope: input.isInScope ?? true,
    },
  })
  expect(response.status(), `create product mapping failed: ${response.status()}`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, 'Product mapping create response should include id')
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
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const response = await apiRequest(request, 'POST', RISK_ASSESSMENTS_PATH, {
    token,
    data: {
      statementId,
      criteria: {},
      conclusion: 'negligible',
      ...overrides,
    },
  })
  expect(response.status(), `create risk assessment failed: ${response.status()}`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, 'Risk assessment create response should include id')
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
      name: `TC-EUDR-008 Plot ${stamp}`,
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

/**
 * Creates the required catalog fixture and fails when the catalog peer is unavailable.
 */
async function createCatalogProduct(
  request: APIRequestContext,
  token: string,
  stamp: string,
): Promise<string> {
  const sku = `TC-EUDR-008-${stamp}`
  const response = await apiRequest(request, 'POST', CATALOG_PRODUCTS_PATH, {
    token,
    data: {
      name: `TC-EUDR-008 Coffee ${stamp}`,
      title: `TC-EUDR-008 Coffee ${stamp}`,
      sku,
      hs_code: '090111',
      hsCode: '090111',
    },
  })
  // Catalog is a required peer for this coverage — a 404 here is a broken app
  // build, not a reason to skip (anti-skip rule).
  expect(response.status(), `create catalog product failed: ${response.status()}`).toBe(201)
  const body = await readJsonSafe<{ id?: string; productId?: string }>(response)
  return expectId(body?.id ?? body?.productId, 'Catalog product create response should include id')
}

async function listProductMappingsForProduct(
  request: APIRequestContext,
  token: string,
  productId: string,
): Promise<ProductMappingRow[]> {
  const response = await apiRequest(
    request,
    'GET',
    `${PRODUCT_MAPPINGS_PATH}?productId=${encodeURIComponent(productId)}`,
    { token },
  )
  expect(response.status(), `list product mappings by productId failed: ${response.status()}`).toBe(200)
  const body = await readJsonSafe<ListResponse<ProductMappingRow>>(response)
  return body?.items ?? []
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

function expectRetainUntilAboutFiveYears(retainUntil: string | null | undefined): void {
  expect(typeof retainUntil === 'string' && retainUntil.length > 0, 'lifecycle.retainUntil should be present').toBe(true)
  const expected = new Date()
  expected.setUTCFullYear(expected.getUTCFullYear() + 5)
  const actualTime = new Date(retainUntil ?? '').getTime()
  expect(Number.isNaN(actualTime), 'lifecycle.retainUntil should parse as a date').toBe(false)
  expect(Math.abs(actualTime - expected.getTime())).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000)
}

/**
 * TC-EUDR-008: EUDR ecosystem surfaces.
 */
test.describe('TC-EUDR-008: Ecosystem surfaces', () => {
  test('returns dashboard compliance overview counts and statutory deadline', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${randomUUID()}`
    const statementIds: string[] = []
    const submissionIds: string[] = []
    const assessmentIds: string[] = []
    const mappingIds: string[] = []
    let supplierId: string | null = null

    try {
      supplierId = await createCompanyFixture(request, token, `TC-EUDR-008 Dashboard Supplier ${stamp}`)
      mappingIds.push(await createProductMapping(request, token, { stamp: `${stamp}-dashboard`, isInScope: true }))
      submissionIds.push(await createSubmission(request, token, {
        supplierEntityId: supplierId,
        commodity: 'coffee',
      }))
      const draftStatementId = await createStatement(request, token, `TC-EUDR-008 Dashboard Draft ${stamp}`)
      statementIds.push(draftStatementId)
      const assessedStatementId = await createStatement(request, token, `TC-EUDR-008 Dashboard Review ${stamp}`)
      statementIds.push(assessedStatementId)
      submissionIds.push(await createSubmission(request, token, {
        supplierEntityId: supplierId,
        commodity: 'coffee',
        statementId: assessedStatementId,
        ...completeSubmissionFields(`${stamp}-review`),
        status: 'verified',
      }))
      assessmentIds.push(await createRiskAssessment(request, token, assessedStatementId, {
        reviewDueAt: isoDaysFromNow(10),
      }))

      const dashboardResponse = await apiRequest(request, 'GET', DASHBOARD_PATH, { token })
      expect(dashboardResponse.status(), `dashboard overview failed: ${dashboardResponse.status()}`).toBe(200)
      const dashboard = asRecord(await readJsonSafe(dashboardResponse))
      expect(dashboard, 'dashboard response should be an object').toBeTruthy()
      expect(numberField(dashboard, 'mappingsInScope'), 'dashboard should count in-scope mappings').toBeGreaterThanOrEqual(1)
      const submissions = asRecord(dashboard?.submissions)
      expect(submissions, 'dashboard response should include submissions').toBeTruthy()
      expect(numberField(submissions, 'incomplete'), 'dashboard should count incomplete submissions').toBeGreaterThanOrEqual(1)
      const statements = asRecord(dashboard?.statements)
      expect(statements, 'dashboard response should include statements').toBeTruthy()
      expect(numberField(asRecord(statements?.byStatus), 'draft'), 'dashboard should count draft statements').toBeGreaterThanOrEqual(1)
      expect(numberField(dashboard, 'riskReviewsDueSoon'), 'dashboard should count risk reviews due soon').toBeGreaterThanOrEqual(1)
      const deadline = asRecord(dashboard?.deadline)
      expect(deadline?.date).toBe('2026-12-30')
      expect(numberField(deadline, 'daysLeft')).toBeGreaterThan(0)
    } finally {
      for (const id of assessmentIds.reverse()) await deleteByCrudPath(request, token, RISK_ASSESSMENTS_PATH, id)
      for (const id of submissionIds.reverse()) await deleteByCrudPath(request, token, EVIDENCE_SUBMISSIONS_PATH, id)
      for (const id of statementIds.reverse()) await deleteByCrudPath(request, token, STATEMENTS_PATH, id)
      for (const id of mappingIds.reverse()) await deleteByCrudPath(request, token, PRODUCT_MAPPINGS_PATH, id)
      await deleteEntityIfExists(request, token, CUSTOMERS_COMPANIES_PATH, supplierId)
    }
  })

  test('suggests catalog products, applies mappings, and enriches catalog list responses', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${randomUUID()}`
    const mappingIds = new Set<string>()
    let productId: string | null = null

    try {
      productId = await createCatalogProduct(request, token, stamp)

      const suggestionsResponse = await apiRequest(request, 'GET', PRODUCT_MAPPING_SUGGESTIONS_PATH, { token })
      expect(suggestionsResponse.status(), `GET mapping suggestions failed: ${suggestionsResponse.status()}`).toBe(200)
      const suggestions = extractItems<SuggestionRow>(await readJsonSafe(suggestionsResponse))
      expect(suggestions).toContainEqual(expect.objectContaining({
        productId,
        suggestedCommodity: 'coffee',
      }))

      const applyResponse = await apiRequest(request, 'POST', PRODUCT_MAPPING_SUGGESTIONS_APPLY_PATH, {
        token,
        data: { productIds: [productId] },
      })
      expect(applyResponse.status(), `apply mapping suggestion failed: ${applyResponse.status()}`).toBe(200)
      const applyBody = await readJsonSafe<ApplySuggestionsResponse>(applyResponse)
      expect(applyBody?.created).toBe(1)
      for (const id of [...(applyBody?.ids ?? []), ...(applyBody?.createdIds ?? [])]) mappingIds.add(id)

      const mappings = await listProductMappingsForProduct(request, token, productId)
      expect(mappings).toContainEqual(expect.objectContaining({ productId, commodity: 'coffee' }))
      for (const mapping of mappings) mappingIds.add(mapping.id)

      const suggestionsAfterApplyResponse = await apiRequest(request, 'GET', PRODUCT_MAPPING_SUGGESTIONS_PATH, { token })
      expect(suggestionsAfterApplyResponse.status(), `GET suggestions after apply failed: ${suggestionsAfterApplyResponse.status()}`).toBe(200)
      const suggestionsAfterApply = extractItems<SuggestionRow>(await readJsonSafe(suggestionsAfterApplyResponse))
      expect(suggestionsAfterApply.find((item) => item.productId === productId)).toBeUndefined()

      const duplicateApplyResponse = await apiRequest(request, 'POST', PRODUCT_MAPPING_SUGGESTIONS_APPLY_PATH, {
        token,
        data: { productIds: [productId] },
      })
      expect(duplicateApplyResponse.status(), `duplicate apply response failed: ${duplicateApplyResponse.status()}`).toBe(200)
      const duplicateApply = await readJsonSafe<ApplySuggestionsResponse>(duplicateApplyResponse)
      expect(duplicateApply?.failed?.[0]?.productId).toBe(productId)
      expect(JSON.stringify(duplicateApply?.failed?.[0])).toContain('duplicate')

      const catalogReadbackResponse = await apiRequest(
        request,
        'GET',
        `${CATALOG_PRODUCTS_PATH}?ids=${encodeURIComponent(productId)}`,
        { token },
      )
      expect(catalogReadbackResponse.status(), `catalog product readback failed: ${catalogReadbackResponse.status()}`).toBe(200)
      const catalogReadback = await readJsonSafe<ListResponse<CatalogProductRow>>(catalogReadbackResponse)
      const product = catalogReadback?.items?.find((item) => item.id === productId)
      expect(product?._eudr).toEqual(expect.objectContaining({ commodity: 'coffee' }))
    } finally {
      for (const id of Array.from(mappingIds).reverse()) await deleteByCrudPath(request, token, PRODUCT_MAPPINGS_PATH, id)
      await deleteByCrudPath(request, token, CATALOG_PRODUCTS_PATH, productId)
    }
  })

  test('exports v2 JSON and GeoJSON with risk, plot, and lifecycle data', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const stamp = `${Date.now()}-${randomUUID()}`
    let supplierId: string | null = null
    let plotId: string | null = null
    let statementId: string | null = null
    let submissionId: string | null = null
    let assessmentId: string | null = null

    try {
      supplierId = await createCompanyFixture(request, token, `TC-EUDR-008 Export Supplier ${stamp}`)
      plotId = await createPlot(request, token, supplierId, stamp)
      statementId = await createStatement(request, token, `TC-EUDR-008 Export ${stamp}`)
      submissionId = await createSubmission(request, token, {
        supplierEntityId: supplierId,
        commodity: 'coffee',
        statementId,
        plotIds: [plotId],
        ...completeSubmissionFields(`${stamp}-export`, { geolocation: undefined }),
        status: 'verified',
      })
      assessmentId = await createRiskAssessment(request, token, statementId)

      const exportResponse = await apiRequest(
        request,
        'GET',
        `${STATEMENTS_PATH}/${encodeURIComponent(statementId)}/export`,
        { token },
      )
      expect(exportResponse.status(), `statement export failed: ${exportResponse.status()}`).toBe(200)
      const exportBody = await readJsonSafe<ExportJsonResponse>(exportResponse)
      expect(Object.prototype.hasOwnProperty.call(exportBody ?? {}, 'riskAssessment')).toBe(true)
      expect(Array.isArray(exportBody?.plots), 'export should include plots array').toBe(true)
      expect(Object.prototype.hasOwnProperty.call(exportBody ?? {}, 'lifecycle')).toBe(true)
      expectRetainUntilAboutFiveYears(exportBody?.lifecycle?.retainUntil)

      const geoJsonResponse = await apiRequest(
        request,
        'GET',
        `${STATEMENTS_PATH}/${encodeURIComponent(statementId)}/export?format=geojson`,
        { token },
      )
      expect(geoJsonResponse.status(), `GeoJSON export failed: ${geoJsonResponse.status()}`).toBe(200)
      const geoJson = await readJsonSafe<GeoJsonFeatureCollection>(geoJsonResponse)
      expect(geoJson?.type).toBe('FeatureCollection')
      expect(geoJson?.features?.length ?? 0).toBeGreaterThanOrEqual(1)
      expect(geoJson?.features?.some((feature) => (
        feature.properties?.plotId === plotId
        && typeof feature.properties?.supplierName === 'string'
        && feature.properties.supplierName.length > 0
      ))).toBe(true)

      const unknownExportResponse = await apiRequest(
        request,
        'GET',
        `${STATEMENTS_PATH}/${encodeURIComponent(randomUUID())}/export`,
        { token },
      )
      expect(unknownExportResponse.status(), 'unknown statement export should return 404').toBe(404)

      const employeeExportResponse = await apiRequest(
        request,
        'GET',
        `${STATEMENTS_PATH}/${encodeURIComponent(statementId)}/export`,
        { token: employeeToken },
      )
      expect(employeeExportResponse.status(), 'view-only employee should be allowed to export statement').toBe(200)
    } finally {
      await deleteByCrudPath(request, token, RISK_ASSESSMENTS_PATH, assessmentId)
      await deleteByCrudPath(request, token, EVIDENCE_SUBMISSIONS_PATH, submissionId)
      await deleteByCrudPath(request, token, STATEMENTS_PATH, statementId)
      await deleteByCrudPath(request, token, PLOTS_PATH, plotId)
      await deleteEntityIfExists(request, token, CUSTOMERS_COMPANIES_PATH, supplierId)
    }
  })
})

test.describe('TC-EUDR-008b: per-feature rollup gating on the compliance overview', () => {
  test('omits rollup blocks the caller has no feature for and keeps them for full-feature callers', async ({ request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenContext(adminToken)
    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const email = `tc-eudr-008b-${stamp}@example.com`
    let limitedUserId: string | null = null

    try {
      limitedUserId = await createUserFixture(request, adminToken, {
        email,
        password: 'Valid1!Pass',
        organizationId: scope.organizationId,
        roles: ['employee'],
      })
      await setUserAclInDb({
        userId: limitedUserId,
        tenantId: scope.tenantId,
        features: ['eudr.statements.view'],
        organizations: null,
      })
      const limitedToken = await getAuthToken(request, email, 'Valid1!Pass')

      const limitedResponse = await apiRequest(request, 'GET', DASHBOARD_PATH, { token: limitedToken })
      expect(limitedResponse.status(), `limited overview failed: ${limitedResponse.status()}`).toBe(200)
      const limitedBody = await readJsonSafe<Record<string, unknown>>(limitedResponse)
      expect(limitedBody?.statements, 'base statements rollup stays for statements.view').toBeTruthy()
      expect(limitedBody?.deadline, 'deadline stays on the base gate').toBeTruthy()
      expect(limitedBody?.mappingsInScope, 'mappingsInScope requires eudr.mappings.view').toBeUndefined()
      expect(limitedBody?.submissions, 'submissions rollup requires eudr.submissions.view').toBeUndefined()
      expect(limitedBody?.riskReviewsDueSoon, 'risk rollup requires eudr.risk.view').toBeUndefined()

      const adminResponse = await apiRequest(request, 'GET', DASHBOARD_PATH, { token: adminToken })
      expect(adminResponse.status()).toBe(200)
      const adminBody = await readJsonSafe<Record<string, unknown>>(adminResponse)
      expect(adminBody?.mappingsInScope, 'full-feature caller sees every rollup').toBeDefined()
      expect(adminBody?.submissions).toBeDefined()
      expect(adminBody?.riskReviewsDueSoon).toBeDefined()
    } finally {
      await deleteUserIfExists(request, adminToken, limitedUserId)
      if (limitedUserId) await deleteUserAclInDb(limitedUserId)
    }
  })
})
