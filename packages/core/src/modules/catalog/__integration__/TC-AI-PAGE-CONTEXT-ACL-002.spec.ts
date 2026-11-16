import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  deleteGeneralEntityIfExists,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'

const USER_PASSWORD = 'Valid1!Pass'
const EXECUTE = '/api/ai_assistant/tools/execute'
const CATALOG_READ = ['ai_assistant.view', 'catalog.products.view']

type ToolCall = { status: number; text: string }

async function runTool(
  request: APIRequestContext,
  token: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolCall> {
  const response = await apiRequest(request, 'POST', EXECUTE, { token, data: { toolName, args } })
  return { status: response.status(), text: await response.text() }
}

async function createTenant(request: APIRequestContext, token: string, name: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', { token, data: { name } })
  expect(response.status(), 'POST /api/directory/tenants should return 201').toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  if (!body?.id) throw new Error('[internal] tenant create response missing id')
  return body.id
}

/**
 * TC-AI-PAGE-CONTEXT-ACL-002: the catalog page-context hydration path
 * (`hydrateCatalogAssistantContext` / `hydrateMerchandisingAssistantContext`)
 * builds the model context from `catalog.get_product` and
 * `catalog.list_selected_products`. This spec drives those real tool handlers
 * with real, isolated callers — no tool pack mocks and no model — and asserts a
 * permitted control sees the product while a caller without
 * `catalog.products.view`, a caller in an excluded organization and a caller
 * in a foreign tenant never receive the product data.
 */
test.describe('TC-AI-PAGE-CONTEXT-ACL-002: catalog page-context tools honor caller ACL and scope', () => {
  test('returns the product only to callers allowed to read it', async ({ request }) => {
    test.slow()
    const stamp = Date.now()
    const productTitle = `QA Page Ctx Product ${stamp}`
    let adminToken: string | null = null
    let superadminToken: string | null = null
    const roleIds: string[] = []
    const userIds: string[] = []
    const organizationIds: string[] = []
    let foreignTenantId: string | null = null
    let productId: string | null = null

    const createActor = async (input: {
      suffix: string
      token: string
      tenantId: string
      homeOrganizationId: string
      features: string[]
      visibleOrganizations?: string[]
    }): Promise<string> => {
      const roleName = `qa_ai_catalog_ctx_${input.suffix}_${stamp}`
      const roleId = await createRoleFixture(request, input.token, { name: roleName, tenantId: input.tenantId })
      roleIds.push(roleId)
      const aclResponse = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
        token: input.token,
        data: { roleId, features: input.features },
      })
      expect(aclResponse.ok(), 'PUT role ACL should succeed').toBeTruthy()
      const email = `qa-ai-catalog-ctx-${input.suffix}-${stamp}@acme.com`
      const userId = await createUserFixture(request, input.token, {
        email,
        password: USER_PASSWORD,
        organizationId: input.homeOrganizationId,
        roles: [roleName],
        name: `QA catalog context ${input.suffix}`,
      })
      userIds.push(userId)
      if (input.visibleOrganizations) {
        await setUserAclVisibility(request, input.token, {
          userId,
          organizations: input.visibleOrganizations,
          features: input.features,
        })
      }
      return getAuthToken(request, email, USER_PASSWORD)
    }

    try {
      adminToken = await getAuthToken(request, 'admin')
      superadminToken = await getAuthToken(request, 'superadmin')
      const scope = getTokenScope(adminToken)
      productId = await createProductFixture(request, adminToken, { title: productTitle, sku: `QA-CTX-${stamp}` })
      const getProduct = { productId }
      const listSelected = { productIds: [productId] }

      const permittedToken = await createActor({
        suffix: 'permitted',
        token: adminToken,
        tenantId: scope.tenantId,
        homeOrganizationId: scope.organizationId,
        features: CATALOG_READ,
      })
      const permittedProduct = await runTool(request, permittedToken, 'catalog.get_product', getProduct)
      expect(permittedProduct.status, 'permitted get_product succeeds').toBe(200)
      expect(permittedProduct.text, 'permitted control sees the product').toContain(productTitle)
      const permittedList = await runTool(request, permittedToken, 'catalog.list_selected_products', listSelected)
      expect(permittedList.status, 'permitted list_selected_products succeeds').toBe(200)
      expect(permittedList.text, 'permitted control sees the selected product').toContain(productTitle)

      const noFeatureToken = await createActor({
        suffix: 'nofeature',
        token: adminToken,
        tenantId: scope.tenantId,
        homeOrganizationId: scope.organizationId,
        features: ['ai_assistant.view'],
      })

      const otherOrganizationId = await createOrganizationFixture(request, adminToken, {
        name: `QA Catalog Ctx Other Org ${stamp}`,
        tenantId: scope.tenantId,
      })
      organizationIds.push(otherOrganizationId)
      const excludedOrgToken = await createActor({
        suffix: 'excludedorg',
        token: adminToken,
        tenantId: scope.tenantId,
        homeOrganizationId: otherOrganizationId,
        features: CATALOG_READ,
        visibleOrganizations: [otherOrganizationId],
      })

      foreignTenantId = await createTenant(request, superadminToken, `QA Catalog Ctx Tenant ${stamp}`)
      const foreignOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA Catalog Ctx Foreign Org ${stamp}`,
        tenantId: foreignTenantId,
      })
      organizationIds.push(foreignOrganizationId)
      const foreignTenantToken = await createActor({
        suffix: 'foreigntenant',
        token: superadminToken,
        tenantId: foreignTenantId,
        homeOrganizationId: foreignOrganizationId,
        features: CATALOG_READ,
      })

      const denied: Array<[string, string]> = [
        ['missing catalog.products.view', noFeatureToken],
        ['excluded organization', excludedOrgToken],
        ['foreign tenant', foreignTenantToken],
      ]
      for (const [label, token] of denied) {
        const product = await runTool(request, token, 'catalog.get_product', getProduct)
        expect(product.text, `${label}: get_product must not disclose the product`).not.toContain(productTitle)
        if (product.status === 200) {
          const body = JSON.parse(product.text) as { result?: { found?: boolean } }
          expect(body.result?.found, `${label}: get_product must report found=false`).toBe(false)
        }
        const list = await runTool(request, token, 'catalog.list_selected_products', listSelected)
        expect(list.text, `${label}: list_selected_products must not disclose the product`).not.toContain(productTitle)
      }
      const noFeatureProduct = await runTool(request, noFeatureToken, 'catalog.get_product', getProduct)
      expect(noFeatureProduct.status, 'get_product refused without catalog.products.view').not.toBe(200)
    } finally {
      await deleteCatalogProductIfExists(request, adminToken, productId)
      for (const userId of userIds) await deleteUserIfExists(request, superadminToken, userId)
      for (const roleId of roleIds) await deleteRoleIfExists(request, superadminToken, roleId)
      for (const organizationId of organizationIds) {
        await deleteOrganizationIfExists(request, superadminToken, organizationId)
      }
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', foreignTenantId)
    }
  })
})
