import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import { deleteTranslationIfExists } from './helpers/translationFixtures'

const ENTITY_TYPE = 'catalog:catalog_product'

/**
 * TC-TRANS-016: DELETE returns 204 for non-existent translation (idempotent)
 * Surfaces: DELETE /api/translations/:entityType/:entityId
 *
 * DELETE is idempotent: it returns 204 even when no translation row ever
 * existed, and a repeated DELETE also returns 204. The no-op delete must not
 * create any side-effect row (a follow-up GET stays 404).
 */
test.describe('TC-TRANS-016: DELETE is idempotent (204)', () => {
  test('returns 204 for a never-saved translation and on repeat, creating no row', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const saToken = await getAuthToken(request, 'superadmin')
    const productTitle = `QA TC-TRANS-016 ${Date.now()}`
    const sku = `QA-TRANS-016-${Date.now()}`
    let productId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, { title: productTitle, sku })

      const firstDelete = await apiRequest(request, 'DELETE', `/api/translations/${ENTITY_TYPE}/${productId}`, { token: saToken })
      expect(firstDelete.status()).toBe(204)

      const secondDelete = await apiRequest(request, 'DELETE', `/api/translations/${ENTITY_TYPE}/${productId}`, { token: saToken })
      expect(secondDelete.status()).toBe(204)

      const getResponse = await apiRequest(request, 'GET', `/api/translations/${ENTITY_TYPE}/${productId}`, { token: saToken })
      expect(getResponse.status()).toBe(404)
    } finally {
      await deleteTranslationIfExists(request, saToken, ENTITY_TYPE, productId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
    }
  })
})
