import { randomInt } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-CAT-036 [P1]: product list filters honor the multi-organization scope (#6466).
 *
 * Under "All organizations" the search / category / tag prequeries in
 * `buildProductFilters` used to filter on `organization_id = NULL`, so every
 * filtered product search came back empty. The fix builds the prequery scope from
 * the request's resolved organization set. The unit suite only asserts the shape of
 * the `where` object against a mocked EntityManager; this spec drives the real
 * endpoint against a real database and pins both sides of the boundary:
 *
 * - "All organizations" (unrestricted caller) → filters match products in every org;
 * - a single selected organization → filters match that org only;
 * - a user whose visibility is restricted to one org, even when asking for
 *   "All organizations" → filters match that org only (the wrong-scope read stays closed);
 * - in every scope, the filtered result agrees with what the main list query
 *   returns for the same products unfiltered.
 *
 * Covers: GET /api/catalog/products (`search`, `categoryIds`, `tagIds`), GET /api/catalog/tags.
 */
const ALL_ORGANIZATIONS = '__all__'
const PASSWORD = 'StrongSecret123!'

type ListResponse = { items?: Array<{ id?: string }>; total?: number }

async function listIds(
  request: APIRequestContext,
  token: string,
  selectedOrgId: string,
  path: string,
): Promise<string[]> {
  const response = await apiRequestWithSelectedOrg(request, 'GET', path, { token, selectedOrgId })
  expect(response.status(), `GET ${path} should return 200`).toBe(200)
  const body = (await readJsonSafe<ListResponse>(response)) ?? {}
  const ids = (body.items ?? [])
    .map((item) => item.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  expect(body.total, `GET ${path} total should match the returned page`).toBe(ids.length)
  return ids.sort()
}

async function createInOrg(
  request: APIRequestContext,
  token: string,
  organizationId: string,
  path: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequestWithSelectedOrg(request, 'POST', path, {
    token,
    selectedOrgId: organizationId,
    data,
  })
  expect(response.status(), `POST ${path} should return 201`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, `POST ${path} should return an id`)
}

async function deleteInOrg(
  request: APIRequestContext,
  token: string,
  organizationId: string | null,
  path: string,
  id: string | null,
): Promise<void> {
  if (!organizationId || !id) return
  await apiRequestWithSelectedOrg(request, 'DELETE', `${path}?id=${encodeURIComponent(id)}`, {
    token,
    selectedOrgId: organizationId,
  }).catch(() => undefined)
}

test.describe('TC-CAT-036: product filters under the multi-organization scope (#6466)', () => {
  test('matches every visible organization and never widens past the caller scope', async ({ request }) => {
    test.setTimeout(120_000)
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { organizationId: homeOrganizationId, tenantId } = getTokenContext(superadminToken)
    const stamp = `${Date.now()}${randomInt(1_000_000)}`
    const term = `qa036term${stamp}`
    const tagLabel = `qa036tag${stamp}`
    const email = `qa-tc-cat-036-${stamp}@example.com`

    let orgA: string | null = null
    let orgB: string | null = null
    let categoryA: string | null = null
    let categoryB: string | null = null
    let productA: string | null = null
    let productB: string | null = null
    let roleId: string | null = null
    let userId: string | null = null

    try {
      orgA = await createOrganizationFixture(request, superadminToken, { name: `QA TC-CAT-036 A ${stamp}`, tenantId })
      orgB = await createOrganizationFixture(request, superadminToken, { name: `QA TC-CAT-036 B ${stamp}`, tenantId })
      categoryA = await createInOrg(request, superadminToken, orgA, '/api/catalog/categories', { name: `QA 036 A ${stamp}` })
      categoryB = await createInOrg(request, superadminToken, orgB, '/api/catalog/categories', { name: `QA 036 B ${stamp}` })
      const description =
        'Long enough description for SEO checks in QA automation flows. This text keeps the create validation satisfied.'
      productA = await createInOrg(request, superadminToken, orgA, '/api/catalog/products', {
        title: `QA ${term} alpha`,
        sku: `QA-036-A-${stamp}`,
        description,
        categoryIds: [categoryA],
        tags: [tagLabel],
      })
      productB = await createInOrg(request, superadminToken, orgB, '/api/catalog/products', {
        title: `QA ${term} beta`,
        sku: `QA-036-B-${stamp}`,
        description,
        categoryIds: [categoryB],
        tags: [tagLabel],
      })

      const tagIds = await listIds(
        request,
        superadminToken,
        ALL_ORGANIZATIONS,
        `/api/catalog/tags?search=${encodeURIComponent(tagLabel)}&pageSize=100`,
      )
      expect(tagIds, 'each organization should own its own copy of the tag').toHaveLength(2)

      const filters = [
        `search=${encodeURIComponent(term)}`,
        `categoryIds=${categoryA},${categoryB}`,
        `tagIds=${tagIds.join(',')}`,
      ]
      const productPath = (filter: string) => `/api/catalog/products?${filter}&pageSize=100`
      const bothProducts = [productA, productB].sort()

      for (const filter of filters) {
        expect(
          await listIds(request, superadminToken, ALL_ORGANIZATIONS, productPath(filter)),
          `All organizations: ${filter} should match the products of both organizations`,
        ).toEqual(bothProducts)
        expect(
          await listIds(request, superadminToken, orgA, productPath(filter)),
          `Organization A selected: ${filter} should match only organization A`,
        ).toEqual([productA])
      }
      for (const productId of bothProducts) {
        expect(
          await listIds(request, superadminToken, ALL_ORGANIZATIONS, productPath(`id=${productId}`)),
          'All organizations: the unfiltered main query should return every product the filters matched',
        ).toEqual([productId])
      }

      roleId = await createRoleFixture(request, superadminToken, { name: `qa-tc-cat-036-${stamp}` })
      userId = await createUserFixture(request, superadminToken, {
        email,
        password: PASSWORD,
        organizationId: homeOrganizationId,
        roles: [roleId],
        name: 'QA TC-CAT-036',
      })
      await setUserAclVisibility(request, superadminToken, {
        userId,
        organizations: [orgA],
        features: ['catalog.products.view'],
      })
      const restrictedToken = await getAuthToken(request, email, PASSWORD)

      for (const filter of filters) {
        expect(
          await listIds(request, restrictedToken, ALL_ORGANIZATIONS, productPath(filter)),
          `Restricted to organization A: ${filter} under All organizations should match only organization A`,
        ).toEqual([productA])
      }
      expect(
        await listIds(request, restrictedToken, ALL_ORGANIZATIONS, productPath(`id=${productB}`)),
        'Restricted to organization A: the main query must not return organization B products either',
      ).toEqual([])
    } finally {
      await deleteUserIfExists(request, superadminToken, userId)
      await deleteRoleIfExists(request, superadminToken, roleId)
      await deleteInOrg(request, superadminToken, orgA, '/api/catalog/products', productA)
      await deleteInOrg(request, superadminToken, orgB, '/api/catalog/products', productB)
      await deleteInOrg(request, superadminToken, orgA, '/api/catalog/categories', categoryA)
      await deleteInOrg(request, superadminToken, orgB, '/api/catalog/categories', categoryB)
      await deleteOrganizationIfExists(request, superadminToken, orgA)
      await deleteOrganizationIfExists(request, superadminToken, orgB)
    }
  })
})
