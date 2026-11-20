import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteTranslationIfExists } from './helpers/translationFixtures'

const entityType = 'catalog:catalog_product'

export const integrationMeta = { dependsOnModules: ['auth', 'catalog', 'translations'] }

test.describe('TC-TRANS-020: translation target authorization and fields', () => {
  test('requires target permissions even when the caller has translation grants', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(adminToken)
    const stamp = randomUUID()
    const email = `translation-role-${stamp}@example.com`
    const password = `Translation1!${randomUUID()}`
    const translations = { de: { title: `Lokalisierter Artikel ${stamp}` } }
    let productId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `Translation permission check ${stamp}`,
        sku: `QA-TRANS-${stamp}`,
      })
      const route = `/api/translations/${entityType}/${productId}`
      const saved = await apiRequest(request, 'PUT', route, { token: adminToken, data: translations })
      expect(saved.status()).toBe(200)

      roleId = await createRoleFixture(request, adminToken, { name: `translation-role-${stamp}`, tenantId })
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: ['translations.view', 'translations.manage'],
        organizations: [organizationId],
      })
      userId = await createUserFixture(request, adminToken, { email, password, organizationId, roles: [roleId] })

      await withCredentialIsolatedRequest(async (isolatedRequest) => {
        const token = await getAuthToken(isolatedRequest, email, password)
        const locales = await apiRequest(isolatedRequest, 'GET', '/api/translations/locales', { token })
        expect(locales.status()).toBe(200)

        const read = await apiRequest(isolatedRequest, 'GET', route, { token })
        expect(read.status()).toBe(403)
        const save = await apiRequest(isolatedRequest, 'PUT', route, { token, data: translations })
        expect(save.status()).toBe(403)
        const remove = await apiRequest(isolatedRequest, 'DELETE', route, { token })
        expect(remove.status()).toBe(403)
      })

      const result = await apiRequest(request, 'GET', route, { token: adminToken })
      expect(result.status()).toBe(200)
      await expect(result.json()).resolves.toMatchObject({ entityId: productId, translations })
    } finally {
      await deleteTranslationIfExists(request, adminToken, entityType, productId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  test('validates the target and localizes a registered field in lists and view exports', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = randomUUID()
    const sku = `QA-TRANS-${stamp}`
    const title = `Localization fixture ${stamp}`
    const translatedTitle = `Lokalisierter Artikel ${stamp}`
    const translations = { de: { title: translatedTitle } }
    let productId: string | null = null

    try {
      productId = await createProductFixture(request, token, { title, sku })
      const route = `/api/translations/${entityType}/${productId}`

      const save = await apiRequest(request, 'PUT', route, { token, data: translations })
      expect(save.status()).toBe(200)
      const invalidField = await apiRequest(request, 'PUT', route, {
        token, data: { de: { title: 'Alternate title', marketingCaption: 'Supplementary text' } },
      })
      expect(invalidField.status()).toBe(400)

      const unregisteredRoute = `/api/translations/catalog:unregistered_translation_target/${productId}`
      const invalidSave = await apiRequest(request, 'PUT', unregisteredRoute, { token, data: translations })
      expect(invalidSave.status()).toBe(400)
      const invalidDelete = await apiRequest(request, 'DELETE', unregisteredRoute, { token })
      expect(invalidDelete.status()).toBe(400)

      const missingOwner = await apiRequest(request, 'PUT', `/api/translations/${entityType}/${randomUUID()}`, {
        token, data: translations,
      })
      expect(missingOwner.status()).toBe(404)
      const result = await apiRequest(request, 'GET', route, { token })
      expect(result.status()).toBe(200)
      await expect(result.json()).resolves.toMatchObject({ entityId: productId, translations })

      const listRoute = `/api/catalog/products?id=${productId}&locale=de`
      const list = await apiRequest(request, 'GET', listRoute, { token })
      expect(list.status()).toBe(200)
      await expect(list.json()).resolves.toMatchObject({
        items: [{ id: productId, sku, title: translatedTitle }],
      })

      const exported = await apiRequest(request, 'GET', `${listRoute}&format=csv&exportScope=view`, { token })
      expect(exported.status()).toBe(200)
      expect(exported.headers()['content-type']).toContain('text/csv')
      const csv = await exported.text()
      expect(csv).toContain(translatedTitle)
      expect(csv).toContain(sku)

      const remove = await apiRequest(request, 'DELETE', route, { token })
      expect(remove.status()).toBe(204)
    } finally {
      await deleteTranslationIfExists(request, token, entityType, productId)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
