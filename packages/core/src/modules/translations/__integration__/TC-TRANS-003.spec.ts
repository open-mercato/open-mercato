import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import { deleteTranslationIfExists } from './helpers/translationFixtures'

const ENTITY_TYPE = 'catalog:catalog_product'
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

/**
 * TC-TRANS-003: Validation & Authorization
 * Covers input validation (entityType, body limits) and basic access control.
 */
test.describe('TC-TRANS-003: Validation & Authorization', () => {
  test('should reject invalid entityType format with 400', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const response = await apiRequest(request, 'PUT', '/api/translations/INVALID/some-id', {
      token,
      data: { en: { title: 'test' } },
    })
    expect(response.status()).toBe(400)
  })

  test('should reject field value exceeding 10000 characters with 400', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const saToken = await getAuthToken(request, 'superadmin')
    const productTitle = `QA TC-TRANS-003-2 ${Date.now()}`
    const sku = `QA-TRANS-003-2-${Date.now()}`
    let productId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, { title: productTitle, sku })
      const longValue = 'x'.repeat(10001)
      const response = await apiRequest(request, 'PUT', `/api/translations/${ENTITY_TYPE}/${productId}`, {
        token: saToken,
        data: { en: { title: longValue } },
      })
      expect(response.status()).toBe(400)
    } finally {
      await deleteTranslationIfExists(request, saToken, ENTITY_TYPE, productId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
    }
  })

  test('should reject locale key exceeding max length with 400', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const saToken = await getAuthToken(request, 'superadmin')
    const productTitle = `QA TC-TRANS-003-3 ${Date.now()}`
    const sku = `QA-TRANS-003-3-${Date.now()}`
    let productId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, { title: productTitle, sku })
      const response = await apiRequest(request, 'PUT', `/api/translations/${ENTITY_TYPE}/${productId}`, {
        token: saToken,
        data: { abcdefghijk: { title: 'test' } },
      })
      expect(response.status()).toBe(400)
    } finally {
      await deleteTranslationIfExists(request, saToken, ENTITY_TYPE, productId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
    }
  })

  test('should reject unauthenticated requests with 401', async ({ request }) => {
    const response = await request.fetch(`${BASE_URL}/api/translations/locales`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(response.status()).toBe(401)
  })
})
