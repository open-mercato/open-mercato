import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { createProductFixture } from '@open-mercato/core/helpers/integration/catalogFixtures'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { deleteUserAclInDb, setUserAclInDb } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['eudr', 'catalog', 'customers'],
}

const MAPPINGS_PATH = '/api/eudr/product-mappings'
const SUBMISSIONS_PATH = '/api/eudr/evidence-submissions'
const STATEMENTS_PATH = '/api/eudr/statements'
const SUPPLIER_COMPLIANCE_PATH = '/api/eudr/suppliers/compliance'
const PRODUCTS_PATH = '/api/catalog/products'
const COMPANIES_PATH = '/api/customers/companies'

type ExportPacket = {
  productMappings?: Array<{
    speciesScientificName?: string | null
    speciesCommonName?: string | null
  }>
  readiness?: { warnings?: string[] }
}

type SupplierCompliance = {
  submissions?: { total?: number; byStatus?: Record<string, number>; avgCompleteness?: number | null }
  lastSubmissionAt?: string | null
  plots?: { total?: number; withWarnings?: number }
}

async function createJson(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', path, { token, data })
  expect(response.status(), `create at ${path} failed: ${response.status()}`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, `create response at ${path} should include id`)
}

async function expectNoErrorState(page: Page): Promise<void> {
  await expect(
    page.getByRole('heading', {
      name: /Application error: a client-side exception has occurred|Something went wrong/i,
    }).first(),
  ).not.toBeVisible()
}

/**
 * TC-EUDR-015: wood species fields and the supplier readiness surface.
 *
 * Species: mapping round-trips both species names; the export packet carries
 * them; a wood mapping missing either name yields the speciesMissing readiness
 * warning while a complete wood mapping does not.
 *
 * Supplier surface: the aggregate route rolls up the supplier's submissions
 * and plots, and the companies-v2 detail page renders the injected
 * "EUDR compliance" panel for a supplier with data.
 */
test.describe('TC-EUDR-015: species fields and supplier readiness', () => {
  test('round-trips species, warns on missing names, aggregates supplier posture', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
    let woodProductId: string | null = null
    let woodMappingId: string | null = null
    let supplierId: string | null = null
    let submissionId: string | null = null
    let statementId: string | null = null
    let submissionsOnlyUserId: string | null = null

    try {
      woodProductId = await createProductFixture(request, token, {
        title: `TC-EUDR-015 Oak ${stamp}`,
        sku: `TC-EUDR-015-${stamp}`,
      })
      woodMappingId = await createJson(request, token, MAPPINGS_PATH, {
        productId: woodProductId,
        commodity: 'wood',
        speciesScientificName: 'Quercus robur',
        speciesCommonName: 'European oak',
      })

      const mappingRead = await apiRequest(request, 'GET', `${MAPPINGS_PATH}?id=${encodeURIComponent(woodMappingId)}`, { token })
      const mappingBody = await readJsonSafe<{ items?: Array<{ speciesScientificName?: string | null; speciesCommonName?: string | null }> }>(mappingRead)
      expect(mappingBody?.items?.[0]?.speciesScientificName).toBe('Quercus robur')
      expect(mappingBody?.items?.[0]?.speciesCommonName).toBe('European oak')

      supplierId = await createCompanyFixture(request, token, `TC-EUDR-015 Supplier ${stamp}`)
      statementId = await createJson(request, token, STATEMENTS_PATH, {
        title: `TC-EUDR-015 Statement ${stamp}`,
        commodity: 'wood',
      })
      submissionId = await createJson(request, token, SUBMISSIONS_PATH, {
        supplierEntityId: supplierId,
        commodity: 'wood',
        productMappingId: woodMappingId,
        statementId,
        originCountry: 'DE',
        quantityKg: 10,
      })

      const completeExport = await apiRequest(request, 'GET', `${STATEMENTS_PATH}/${encodeURIComponent(statementId)}/export`, { token })
      expect(completeExport.status()).toBe(200)
      const completePacket = await readJsonSafe<ExportPacket>(completeExport)
      expect(completePacket?.productMappings?.[0]?.speciesScientificName).toBe('Quercus robur')
      expect(completePacket?.readiness?.warnings ?? []).not.toContain('eudr.warnings.speciesMissing')

      const flipCommodity = await apiRequest(request, 'PUT', MAPPINGS_PATH, {
        token,
        data: { id: woodMappingId, commodity: 'soya' },
      })
      expect(flipCommodity.status(), 'switching the commodity should succeed').toBe(200)
      const flippedRead = await apiRequest(request, 'GET', `${MAPPINGS_PATH}?id=${encodeURIComponent(woodMappingId)}`, { token })
      const flippedBody = await readJsonSafe<{ items?: Array<{ speciesScientificName?: string | null; speciesCommonName?: string | null }> }>(flippedRead)
      expect(flippedBody?.items?.[0]?.speciesScientificName, 'server clears species when commodity leaves wood').toBeNull()
      expect(flippedBody?.items?.[0]?.speciesCommonName, 'server clears species when commodity leaves wood').toBeNull()

      const restoreWood = await apiRequest(request, 'PUT', MAPPINGS_PATH, {
        token,
        data: { id: woodMappingId, commodity: 'wood', speciesScientificName: 'Quercus robur' },
      })
      expect(restoreWood.status(), 'restoring the wood commodity should succeed').toBe(200)
      const clearSpecies = await apiRequest(request, 'PUT', MAPPINGS_PATH, {
        token,
        data: { id: woodMappingId, speciesCommonName: null },
      })
      expect(clearSpecies.status(), 'clearing the common name should succeed').toBe(200)
      const warnedExport = await apiRequest(request, 'GET', `${STATEMENTS_PATH}/${encodeURIComponent(statementId)}/export`, { token })
      const warnedPacket = await readJsonSafe<ExportPacket>(warnedExport)
      expect(
        warnedPacket?.readiness?.warnings ?? [],
        'missing common name on a wood mapping must warn',
      ).toContain('eudr.warnings.speciesMissing')

      const complianceResponse = await apiRequest(
        request,
        'GET',
        `${SUPPLIER_COMPLIANCE_PATH}?supplierEntityId=${encodeURIComponent(supplierId)}`,
        { token },
      )
      expect(complianceResponse.status(), `supplier compliance failed: ${complianceResponse.status()}`).toBe(200)
      const compliance = await readJsonSafe<SupplierCompliance>(complianceResponse)
      expect(compliance?.submissions?.total ?? 0).toBeGreaterThanOrEqual(1)
      expect(compliance?.lastSubmissionAt, 'lastSubmissionAt should be set').toBeTruthy()
      expect(compliance?.plots, 'admin holds eudr.plots.view so the plots block must be present').toBeTruthy()

      const scope = getTokenContext(token)
      const submissionsOnlyEmail = `tc-eudr-015-submissions-${stamp}@example.com`
      submissionsOnlyUserId = await createUserFixture(request, token, {
        email: submissionsOnlyEmail,
        password: 'Valid1!Pass',
        organizationId: scope.organizationId,
        roles: ['employee'],
      })
      await setUserAclInDb({
        userId: submissionsOnlyUserId,
        tenantId: scope.tenantId,
        features: ['eudr.submissions.view'],
        organizations: null,
      })
      const submissionsOnlyToken = await getAuthToken(request, submissionsOnlyEmail, 'Valid1!Pass')
      const submissionsOnlyResponse = await apiRequest(
        request,
        'GET',
        `${SUPPLIER_COMPLIANCE_PATH}?supplierEntityId=${encodeURIComponent(supplierId)}`,
        { token: submissionsOnlyToken },
      )
      expect(
        submissionsOnlyResponse.status(),
        `submissions-only supplier compliance failed: ${submissionsOnlyResponse.status()}`,
      ).toBe(200)
      const submissionsOnlyCompliance = await readJsonSafe<SupplierCompliance>(submissionsOnlyResponse)
      expect(submissionsOnlyCompliance?.submissions, 'submissions block stays on the base feature gate').toBeTruthy()
      expect(submissionsOnlyCompliance?.plots, 'plots require eudr.plots.view').toBeUndefined()

      const invalidResponse = await apiRequest(request, 'GET', `${SUPPLIER_COMPLIANCE_PATH}?supplierEntityId=not-a-uuid`, { token })
      expect(invalidResponse.status()).toBe(400)

      await login(page, 'admin')
      await page.goto(`/backend/customers/companies-v2/${encodeURIComponent(supplierId)}`, {
        waitUntil: 'domcontentloaded',
      })
      await expect(page.getByText('EUDR compliance').first()).toBeVisible({ timeout: 20_000 })
      await expect(page.getByText('Evidence submissions').first()).toBeVisible()
      await expect(page.locator('body')).not.toContainText(supplierId)
      await expectNoErrorState(page)
    } finally {
      await deleteUserIfExists(request, token, submissionsOnlyUserId)
      if (submissionsOnlyUserId) await deleteUserAclInDb(submissionsOnlyUserId)
      await deleteEntityIfExists(request, token, SUBMISSIONS_PATH, submissionId)
      await deleteEntityIfExists(request, token, STATEMENTS_PATH, statementId)
      await deleteEntityIfExists(request, token, MAPPINGS_PATH, woodMappingId)
      await deleteEntityIfExists(request, token, COMPANIES_PATH, supplierId)
      await deleteEntityIfExists(request, token, PRODUCTS_PATH, woodProductId)
    }
  })
})
