import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createProductFixture,
  createVariantFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import {
  deleteGeneralEntityIfExists,
  expectId,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'

async function createTenantFixture(request: APIRequestContext, token: string, name: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', { token, data: { name } })
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(response.status(), 'POST /api/directory/tenants should return 201').toBe(201)
  return expectId(body?.id, 'Tenant creation response should include id')
}

async function readItem(
  request: APIRequestContext,
  token: string,
  path: string,
  id: string,
): Promise<Record<string, unknown> | undefined> {
  const response = await apiRequest(request, 'GET', `${path}?id=${encodeURIComponent(id)}`, { token })
  expect(response.status(), `GET ${path} should return 200`).toBe(200)
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response)
  return (body?.items ?? []).find((entry) => entry.id === id)
}

/**
 * TC-CAT-041: catalog writes treat another tenant's records as not found (#3825)
 *
 * A product or variant id that exists only in another tenant must look exactly like an
 * unknown id: update, delete and variant create answer 404, not 403, and nothing changes.
 */
test.describe("TC-CAT-041: catalog writes do not reveal other tenants' records", () => {
  test('foreign-tenant product and variant writes answer 404 and change nothing', async ({ request }) => {
    test.slow()
    const stamp = Date.now()
    const password = `Qa-${randomUUID()}-Aa1!`
    const actorEmail = `qa-tc-cat-041-${stamp}@example.com`
    const productTitle = `QA TC-CAT-041 ${stamp}`
    const variantName = `QA TC-CAT-041 variant ${stamp}`
    let adminToken: string | null = null
    let superadminToken: string | null = null
    let productId: string | null = null
    let variantId: string | null = null
    let foreignTenantId: string | null = null
    let foreignOrganizationId: string | null = null
    let roleId: string | null = null
    let actorUserId: string | null = null
    try {
      adminToken = await getAuthToken(request, 'admin')
      superadminToken = await getAuthToken(request, 'superadmin')
      productId = await createProductFixture(request, adminToken, {
        title: productTitle,
        sku: `QA-CAT-041-${stamp}`,
      })
      variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: variantName,
        sku: `QA-CAT-041-V-${stamp}`,
      })

      foreignTenantId = await createTenantFixture(request, superadminToken, `QA TC-CAT-041 tenant ${stamp}`)
      foreignOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-CAT-041 org ${stamp}`,
        tenantId: foreignTenantId,
      })
      roleId = await createRoleFixture(request, superadminToken, {
        name: `qa-tc-cat-041-${stamp}`,
        tenantId: foreignTenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: ['catalog.products.view', 'catalog.products.manage', 'catalog.variants.manage'],
        organizations: [foreignOrganizationId],
      })
      actorUserId = await createUserFixture(request, superadminToken, {
        email: actorEmail,
        password,
        organizationId: foreignOrganizationId,
        roles: [roleId],
        name: 'QA TC-CAT-041 Actor',
      })
      const actorToken = await getAuthToken(request, actorEmail, password)

      const unknownUpdate = await apiRequest(request, 'PUT', '/api/catalog/products', {
        token: actorToken,
        data: { id: randomUUID(), title: 'Probe' },
      })
      expect(unknownUpdate.status(), 'baseline: unknown product id').toBe(404)

      const productUpdate = await apiRequest(request, 'PUT', '/api/catalog/products', {
        token: actorToken,
        data: { id: productId, title: 'Hijacked' },
      })
      expect(productUpdate.status(), 'foreign-tenant product update must look like an unknown id').toBe(404)

      const productDelete = await apiRequest(
        request,
        'DELETE',
        `/api/catalog/products?id=${encodeURIComponent(productId)}`,
        { token: actorToken },
      )
      expect(productDelete.status(), 'foreign-tenant product delete must look like an unknown id').toBe(404)

      const variantCreate = await apiRequest(request, 'POST', '/api/catalog/variants', {
        token: actorToken,
        data: { productId, name: 'Hijacked', sku: `QA-CAT-041-X-${stamp}`, isActive: true },
      })
      expect(variantCreate.status(), 'variant create on a foreign-tenant product must look like an unknown product').toBe(404)

      const variantUpdate = await apiRequest(request, 'PUT', '/api/catalog/variants', {
        token: actorToken,
        data: { id: variantId, name: 'Hijacked' },
      })
      expect(variantUpdate.status(), 'foreign-tenant variant update must look like an unknown id').toBe(404)

      const variantDelete = await apiRequest(
        request,
        'DELETE',
        `/api/catalog/variants?id=${encodeURIComponent(variantId)}`,
        { token: actorToken },
      )
      expect(variantDelete.status(), 'foreign-tenant variant delete must look like an unknown id').toBe(404)

      const product = await readItem(request, adminToken, '/api/catalog/products', productId)
      expect(product?.title, 'product must be untouched').toBe(productTitle)
      const variant = await readItem(request, adminToken, '/api/catalog/variants', variantId)
      expect(variant?.name, 'variant must be untouched').toBe(variantName)
    } finally {
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await deleteUserIfExists(request, superadminToken, actorUserId)
      await deleteRoleIfExists(request, superadminToken, roleId)
      await deleteOrganizationIfExists(request, superadminToken, foreignOrganizationId)
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', foreignTenantId)
    }
  })
})
