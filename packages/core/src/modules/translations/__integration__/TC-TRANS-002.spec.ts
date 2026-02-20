import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import { deleteTranslationIfExists } from './helpers/translationFixtures'

const ENTITY_TYPE = 'catalog:catalog_product'

/**
 * TC-TRANS-002: Translation CRUD Lifecycle
 * Covers GET/PUT/DELETE /api/translations/:entityType/:entityId — full create-read-update-delete flow.
 */
test.describe('TC-TRANS-002: Translation CRUD Lifecycle', () => {
  test('should return 404 for non-existent translation', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const saToken = await getAuthToken(request, 'superadmin')
    const productTitle = `QA TC-TRANS-002-1 ${Date.now()}`
    const sku = `QA-TRANS-002-1-${Date.now()}`
    let productId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, { title: productTitle, sku })
      const response = await apiRequest(request, 'GET', `/api/translations/${ENTITY_TYPE}/${productId}`, { token: saToken })
      expect(response.status()).toBe(404)
    } finally {
      await deleteTranslationIfExists(request, saToken, ENTITY_TYPE, productId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
    }
  })

  test('should create and retrieve a translation', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const saToken = await getAuthToken(request, 'superadmin')
    const productTitle = `QA TC-TRANS-002-2 ${Date.now()}`
    const sku = `QA-TRANS-002-2-${Date.now()}`
    let productId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, { title: productTitle, sku })

      const putResponse = await apiRequest(request, 'PUT', `/api/translations/${ENTITY_TYPE}/${productId}`, {
        token: saToken,
        data: { de: { title: 'Deutscher Titel' } },
      })
      expect(putResponse.ok()).toBeTruthy()
      const putBody = (await putResponse.json()) as { translations: Record<string, Record<string, string>> }
      expect(putBody.translations.de.title).toBe('Deutscher Titel')

      const getResponse = await apiRequest(request, 'GET', `/api/translations/${ENTITY_TYPE}/${productId}`, { token: saToken })
      expect(getResponse.ok()).toBeTruthy()
      const getBody = (await getResponse.json()) as { translations: Record<string, Record<string, string>> }
      expect(getBody.translations.de.title).toBe('Deutscher Titel')
    } finally {
      await deleteTranslationIfExists(request, saToken, ENTITY_TYPE, productId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
    }
  })

  test('should upsert translations (add locale, update existing)', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const saToken = await getAuthToken(request, 'superadmin')
    const productTitle = `QA TC-TRANS-002-3 ${Date.now()}`
    const sku = `QA-TRANS-002-3-${Date.now()}`
    let productId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, { title: productTitle, sku })

      await apiRequest(request, 'PUT', `/api/translations/${ENTITY_TYPE}/${productId}`, {
        token: saToken,
        data: { de: { title: 'Original' } },
      })

      const upsertResponse = await apiRequest(request, 'PUT', `/api/translations/${ENTITY_TYPE}/${productId}`, {
        token: saToken,
        data: { de: { title: 'Aktualisiert' }, fr: { title: 'Titre Français' } },
      })
      expect(upsertResponse.ok()).toBeTruthy()

      const getResponse = await apiRequest(request, 'GET', `/api/translations/${ENTITY_TYPE}/${productId}`, { token: saToken })
      const body = (await getResponse.json()) as { translations: Record<string, Record<string, string>> }
      expect(body.translations.de.title).toBe('Aktualisiert')
      expect(body.translations.fr.title).toBe('Titre Français')
    } finally {
      await deleteTranslationIfExists(request, saToken, ENTITY_TYPE, productId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
    }
  })

  test('should delete translations and confirm 404', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const saToken = await getAuthToken(request, 'superadmin')
    const productTitle = `QA TC-TRANS-002-4 ${Date.now()}`
    const sku = `QA-TRANS-002-4-${Date.now()}`
    let productId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, { title: productTitle, sku })

      await apiRequest(request, 'PUT', `/api/translations/${ENTITY_TYPE}/${productId}`, {
        token: saToken,
        data: { de: { title: 'Zu löschen' } },
      })

      const deleteResponse = await apiRequest(request, 'DELETE', `/api/translations/${ENTITY_TYPE}/${productId}`, { token: saToken })
      expect(deleteResponse.status()).toBe(204)

      const getResponse = await apiRequest(request, 'GET', `/api/translations/${ENTITY_TYPE}/${productId}`, { token: saToken })
      expect(getResponse.status()).toBe(404)
    } finally {
      await deleteTranslationIfExists(request, saToken, ENTITY_TYPE, productId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
    }
  })
})
