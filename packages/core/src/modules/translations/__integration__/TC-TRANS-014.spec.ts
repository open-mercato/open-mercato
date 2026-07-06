import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import { deleteTranslationIfExists } from './helpers/translationFixtures'

const ENTITY_TYPE = 'catalog:catalog_product'

type TranslationsBody = { translations: Record<string, Record<string, string | null>> }

/**
 * TC-TRANS-014: Translation body with null field values
 * Surfaces: PUT + GET /api/translations/:entityType/:entityId
 *
 * The validator allows null field values (z.union([z.string(), z.null()])).
 * A saved null must round-trip: the key is present with a null value, not
 * silently omitted, on both the PUT response and a fresh GET.
 */
test.describe('TC-TRANS-014: null field values persist', () => {
  test('persists a null field value and returns it (not omitted)', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const saToken = await getAuthToken(request, 'superadmin')
    const productTitle = `QA TC-TRANS-014 ${Date.now()}`
    const sku = `QA-TRANS-014-${Date.now()}`
    let productId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, { title: productTitle, sku })

      const putResponse = await apiRequest(request, 'PUT', `/api/translations/${ENTITY_TYPE}/${productId}`, {
        token: saToken,
        data: { de: { title: null } },
      })
      expect(putResponse.status()).toBe(200)
      const putBody = (await putResponse.json()) as TranslationsBody
      expect(putBody.translations.de).toHaveProperty('title', null)

      const getResponse = await apiRequest(request, 'GET', `/api/translations/${ENTITY_TYPE}/${productId}`, { token: saToken })
      expect(getResponse.status()).toBe(200)
      const getBody = (await getResponse.json()) as TranslationsBody
      expect(getBody.translations.de).toHaveProperty('title')
      expect(getBody.translations.de.title).toBeNull()
    } finally {
      await deleteTranslationIfExists(request, saToken, ENTITY_TYPE, productId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
    }
  })
})
