import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import { deleteTranslationIfExists } from './helpers/translationFixtures'

const ENTITY_TYPE = 'catalog:catalog_product'

/**
 * TC-TRANS-015: Malformed JSON body returns 400
 * Surfaces: PUT /api/translations/:entityType/:entityId
 *
 * A syntactically invalid JSON request body must be rejected with 400 and must
 * not persist anything (a subsequent GET stays 404). The malformed bytes are
 * sent as a Buffer so Playwright transmits them verbatim — passing a raw string
 * with an application/json content type would be re-serialized into a valid JSON
 * string literal, which never exercises the server's body-parse failure path.
 */
test.describe('TC-TRANS-015: malformed JSON body rejected with 400', () => {
  test('rejects a malformed JSON body with 400 and persists nothing', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const saToken = await getAuthToken(request, 'superadmin')
    const productTitle = `QA TC-TRANS-015 ${Date.now()}`
    const sku = `QA-TRANS-015-${Date.now()}`
    let productId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, { title: productTitle, sku })

      const malformedBody = Buffer.from('{"de": {"title": "Broken",}}', 'utf-8')
      const response = await apiRequest(request, 'PUT', `/api/translations/${ENTITY_TYPE}/${productId}`, {
        token: saToken,
        data: malformedBody,
      })
      expect(response.status()).toBe(400)
      const body = (await response.json()) as { error?: string; details?: unknown }
      expect(body.error || body.details).toBeTruthy()

      // The rejected write must not have created a partial record.
      const getResponse = await apiRequest(request, 'GET', `/api/translations/${ENTITY_TYPE}/${productId}`, { token: saToken })
      expect(getResponse.status()).toBe(404)
    } finally {
      await deleteTranslationIfExists(request, saToken, ENTITY_TYPE, productId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
    }
  })
})
