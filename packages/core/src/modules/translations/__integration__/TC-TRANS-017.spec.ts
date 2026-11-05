import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import { deleteTranslationIfExists } from './helpers/translationFixtures'

const ENTITY_TYPE = 'catalog:catalog_product'

/**
 * TC-TRANS-017: Field key with empty string is rejected (min length 1)
 * Surfaces: PUT /api/translations/:entityType/:entityId
 *
 * Field keys must be 1..100 chars. An empty-string field key must be rejected
 * with 400 and persist nothing (a follow-up GET stays 404).
 */
test.describe('TC-TRANS-017: empty field key rejected', () => {
  test('rejects an empty field key with 400 and persists nothing', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const saToken = await getAuthToken(request, 'superadmin')
    const productTitle = `QA TC-TRANS-017 ${Date.now()}`
    const sku = `QA-TRANS-017-${Date.now()}`
    let productId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, { title: productTitle, sku })

      const response = await apiRequest(request, 'PUT', `/api/translations/${ENTITY_TYPE}/${productId}`, {
        token: saToken,
        data: { de: { '': 'value' } },
      })
      expect(response.status()).toBe(400)

      const getResponse = await apiRequest(request, 'GET', `/api/translations/${ENTITY_TYPE}/${productId}`, { token: saToken })
      expect(getResponse.status()).toBe(404)
    } finally {
      await deleteTranslationIfExists(request, saToken, ENTITY_TYPE, productId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
    }
  })
})
