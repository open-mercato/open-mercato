import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'
import { setProductUse, stampOf } from './helpers'
import { createManagers, deleteManagers, type ManagerFixture } from './staffFixtures'
import { encodeProductUseIntent, PRODUCT_USE_INTENT_HEADER } from '../lib/productUseIntent'

type UseList = { items?: Array<{ catalogProductId: string; use: string; billingUnit: string }> }
type SyncBody = { _property_management?: { productUseError?: { status: number; error: string } } }

/**
 * TC-PM-071: product uses need manage_all
 * A product use applies to units of every building, so a building manager (property_management.manage
 * without property_management.buildings.manage_all) gets 403 on POST / PUT / DELETE product-uses. Saving
 * the catalog product with a use intent still saves the product, reports `productUseError` 403 and leaves
 * the use alone. An administrator (manage_all) can change it.
 */
test.describe('TC-PM-071: product use access', () => {
  test('refuses product use writes to a manager without manage_all', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let managers: ManagerFixture | null = null
    let productId: string | null = null
    try {
      managers = await createManagers(request, adminToken, `${stamp}-pu`, 1, ['catalog.products.view', 'catalog.products.manage'])
      const [manager] = managers.users
      productId = await createProductFixture(request, adminToken, { title: `QA PM use ${stamp}`, sku: `QA-PM-USE-${stamp}` })
      expect((await setProductUse(request, adminToken, productId, 'bookable', 'hour')).status()).toBe(201)

      expect((await setProductUse(request, manager.token, productId, 'bookable', 'day')).status(), 'POST product-uses').toBe(403)
      const put = await apiRequest(request, 'PUT', '/api/property_management/product-uses', {
        token: manager.token,
        data: { catalogProductId: productId, use: 'bookable', billingUnit: 'day' },
      })
      expect(put.status(), 'PUT product-uses').toBe(403)
      const del = await apiRequest(request, 'DELETE', `/api/property_management/product-uses?catalogProductId=${productId}`, { token: manager.token })
      expect(del.status(), 'DELETE product-uses').toBe(403)

      const saved = await apiRequest(request, 'PUT', '/api/catalog/products', {
        token: manager.token,
        data: { id: productId, title: `QA PM use renamed ${stamp}` },
        headers: {
          [PRODUCT_USE_INTENT_HEADER]: encodeProductUseIntent({ sourceEntityId: 'catalog:catalog_product', use: 'leasable', billingUnit: 'month' }),
        },
      })
      expect(saved.status(), 'the catalog save itself succeeds').toBe(200)
      const savedBody = await readJsonSafe<SyncBody>(saved)
      expect(savedBody?._property_management?.productUseError?.status).toBe(403)

      const uses = await readJsonSafe<UseList>(
        await apiRequest(request, 'GET', `/api/property_management/product-uses?productIds=${productId}`, { token: adminToken }),
      )
      expect(uses?.items?.map((entry) => [entry.use, entry.billingUnit])).toEqual([['bookable', 'hour']])

      expect((await setProductUse(request, adminToken, productId, 'bookable', 'day')).status(), 'an administrator can change it').toBe(201)
    } finally {
      if (productId) await setProductUse(request, adminToken, productId, null, null).catch(() => undefined)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await deleteManagers(request, adminToken, managers)
    }
  })
})
