import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  encodeCatalogInventoryProfileIntent,
  WMS_CATALOG_PROFILE_HEADER,
} from '../lib/catalogInventoryProfileIntent'

export const integrationMeta = {
  dependsOnModules: ['auth', 'wms', 'catalog'],
}

type CatalogProduct = { id: string; title: string; sku: string }

async function readProducts(request: APIRequestContext, token: string, query: Record<string, string>) {
  const params = new URLSearchParams(query)
  const response = await apiRequest(request, 'GET', `/api/catalog/products?${params}`, { token })
  expect(response.status()).toBe(200)
  return (await readJsonSafe<{ items: CatalogProduct[] }>(response))?.items ?? []
}

test('TC-WMS-CATALOG-PROFILE-002: refuses a WMS profile intent before committing catalog writes', async ({ request }) => {
  const adminToken = await getAuthToken(request, 'admin')
  const { organizationId, tenantId } = getTokenContext(adminToken)
  const suffix = randomUUID()
  const email = `qa-catalog-profile-${suffix}@example.com`
  const password = `QaProfile9!${randomUUID()}`
  const deniedSku = `QA-WMS-DENIED-${suffix}`
  const title = `QA catalog save ${suffix}`
  const headers = {
    [WMS_CATALOG_PROFILE_HEADER]: encodeCatalogInventoryProfileIntent({
      sourceEntityId: 'catalog:catalog_product',
      manageInventory: true,
      defaultUom: 'pcs',
      defaultStrategy: 'fifo',
    }),
  }
  let roleId: string | null = null
  let userId: string | null = null
  let productId: string | null = null
  let unexpectedProductId: string | null = null

  try {
    roleId = await createRoleFixture(request, adminToken, { name: `qa-catalog-${suffix}`, tenantId })
    await setRoleAclFeatures(request, adminToken, { roleId, features: ['catalog.*'], organizations: [organizationId] })
    userId = await createUserFixture(request, adminToken, { email, password, organizationId, roles: [roleId] })
    productId = await createProductFixture(request, adminToken, { sku: `QA-WMS-CONTROL-${suffix}`, title })
    const catalogToken = await getAuthToken(request, email, password)

    const controlTitle = `${title} updated`
    const control = await apiRequest(request, 'PUT', '/api/catalog/products', {
      token: catalogToken,
      data: { id: productId, title: controlTitle },
    })
    expect(control.status()).toBe(200)

    const deniedCreate = await apiRequest(request, 'POST', '/api/catalog/products', {
      token: catalogToken,
      headers,
      data: { title, sku: deniedSku },
    })
    const candidates = await readProducts(request, adminToken, { search: deniedSku })
    unexpectedProductId = candidates.find((item) => item.sku === deniedSku)?.id ?? null
    const deniedUpdate = await apiRequest(request, 'PUT', '/api/catalog/products', {
      token: catalogToken,
      headers,
      data: { id: productId, title: `${title} denied` },
    })
    const [savedProduct] = await readProducts(request, adminToken, { id: productId })
    expect({
      createStatus: deniedCreate.status(),
      committedCreate: unexpectedProductId,
      updateStatus: deniedUpdate.status(),
      savedTitle: savedProduct?.title,
    }).toEqual({
      createStatus: 403,
      committedCreate: null,
      updateStatus: 403,
      savedTitle: controlTitle,
    })
  } finally {
    await deleteCatalogProductIfExists(request, adminToken, unexpectedProductId)
    await deleteCatalogProductIfExists(request, adminToken, productId)
    await deleteUserIfExists(request, adminToken, userId)
    await deleteRoleIfExists(request, adminToken, roleId)
  }
})
