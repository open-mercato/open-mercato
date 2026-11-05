import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import { deleteTranslationIfExists } from './helpers/translationFixtures'

const ENTITY_TYPE = 'catalog:catalog_product'

/**
 * TC-TRANS-012: GET returns 404 for translations without previous save
 * Surfaces: GET /api/translations/:entityType/:entityId
 *
 * Probes the not-found path for a valid entity that never had translations
 * saved. Complements TC-TRANS-002 (which asserts only the 404 status) by also
 * asserting the error-body contract is { error: 'Not found' }.
 */
test.describe('TC-TRANS-012: GET 404 for entity without translations', () => {
  test('returns 404 with a "Not found" error body when no translation exists', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const saToken = await getAuthToken(request, 'superadmin')
    const productTitle = `QA TC-TRANS-012 ${Date.now()}`
    const sku = `QA-TRANS-012-${Date.now()}`
    let productId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, { title: productTitle, sku })

      const response = await apiRequest(request, 'GET', `/api/translations/${ENTITY_TYPE}/${productId}`, { token: saToken })
      expect(response.status()).toBe(404)
      const body = (await response.json()) as { error?: string }
      expect(body.error).toBe('Not found')
    } finally {
      await deleteTranslationIfExists(request, saToken, ENTITY_TYPE, productId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
    }
  })
})
