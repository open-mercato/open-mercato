import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import { deleteTranslationIfExists, ensureRoleFeatures, getLocales, restoreRoleFeatures, setLocales } from './helpers/translationFixtures'

const ENTITY_TYPE = 'catalog:catalog_product'

/**
 * TC-TRANS-008: RBAC Authorization per Role
 * Verifies that translation API endpoints enforce correct feature-based access
 * control for admin (translations.*) and employee (translations.view only).
 *
 * Role matrix:
 *   superadmin — all features (implicit)
 *   admin      — translations.* (all)
 *   employee   — translations.view (read-only)
 */
test.describe('TC-TRANS-008: RBAC Authorization per Role', () => {
  let adminOriginalFeatures: string[] = []
  let employeeOriginalFeatures: string[] = []

  test.beforeAll(async ({ request }) => {
    const saToken = await getAuthToken(request, 'superadmin')
    adminOriginalFeatures = await ensureRoleFeatures(request, saToken, 'admin', ['translations.*'])
    employeeOriginalFeatures = await ensureRoleFeatures(request, saToken, 'employee', ['translations.view'])
  })

  test.afterAll(async ({ request }) => {
    const saToken = await getAuthToken(request, 'superadmin')
    await restoreRoleFeatures(request, saToken, 'admin', adminOriginalFeatures).catch(() => {})
    await restoreRoleFeatures(request, saToken, 'employee', employeeOriginalFeatures).catch(() => {})
  })

  // ─── Admin: full access ───────────────────────────────────────────

  test('admin can GET translations (translations.view)', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const saToken = await getAuthToken(request, 'superadmin')
    const productTitle = `QA TC-TRANS-008-admin-get ${Date.now()}`
    const sku = `QA-T008-AG-${Date.now()}`
    let productId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, { title: productTitle, sku })

      await apiRequest(request, 'PUT', `/api/translations/${ENTITY_TYPE}/${productId}`, {
        token: saToken,
        data: { de: { title: 'Admin GET Test' } },
      })

      const response = await apiRequest(request, 'GET', `/api/translations/${ENTITY_TYPE}/${productId}`, { token: adminToken })
      expect(response.ok()).toBeTruthy()
    } finally {
      await deleteTranslationIfExists(request, saToken, ENTITY_TYPE, productId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
    }
  })

  test('admin can PUT translations (translations.manage)', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const saToken = await getAuthToken(request, 'superadmin')
    const productTitle = `QA TC-TRANS-008-admin-put ${Date.now()}`
    const sku = `QA-T008-AP-${Date.now()}`
    let productId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, { title: productTitle, sku })

      const response = await apiRequest(request, 'PUT', `/api/translations/${ENTITY_TYPE}/${productId}`, {
        token: adminToken,
        data: { de: { title: 'Admin PUT Test' } },
      })
      expect(response.ok()).toBeTruthy()
    } finally {
      await deleteTranslationIfExists(request, saToken, ENTITY_TYPE, productId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
    }
  })

  test('admin can DELETE translations (translations.manage)', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const saToken = await getAuthToken(request, 'superadmin')
    const productTitle = `QA TC-TRANS-008-admin-del ${Date.now()}`
    const sku = `QA-T008-AD-${Date.now()}`
    let productId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, { title: productTitle, sku })

      await apiRequest(request, 'PUT', `/api/translations/${ENTITY_TYPE}/${productId}`, {
        token: saToken,
        data: { de: { title: 'To delete' } },
      })

      const response = await apiRequest(request, 'DELETE', `/api/translations/${ENTITY_TYPE}/${productId}`, { token: adminToken })
      expect(response.status()).toBe(204)
    } finally {
      await deleteTranslationIfExists(request, saToken, ENTITY_TYPE, productId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
    }
  })

  test('admin can PUT locales (translations.manage_locales)', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const originalLocales = await getLocales(request, adminToken)

    try {
      const response = await apiRequest(request, 'PUT', '/api/translations/locales', {
        token: adminToken,
        data: { locales: ['en', 'de'] },
      })
      expect(response.ok()).toBeTruthy()
    } finally {
      await setLocales(request, adminToken, originalLocales).catch(() => {})
    }
  })

  // ─── Employee: view-only ──────────────────────────────────────────

  test('employee can GET translations (translations.view)', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const saToken = await getAuthToken(request, 'superadmin')
    const employeeToken = await getAuthToken(request, 'employee')
    const productTitle = `QA TC-TRANS-008-emp-get ${Date.now()}`
    const sku = `QA-T008-EG-${Date.now()}`
    let productId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, { title: productTitle, sku })

      await apiRequest(request, 'PUT', `/api/translations/${ENTITY_TYPE}/${productId}`, {
        token: saToken,
        data: { de: { title: 'Employee GET Test' } },
      })

      const response = await apiRequest(request, 'GET', `/api/translations/${ENTITY_TYPE}/${productId}`, { token: employeeToken })
      expect(response.ok()).toBeTruthy()
      const body = (await response.json()) as { translations: Record<string, Record<string, string>> }
      expect(body.translations.de.title).toBe('Employee GET Test')
    } finally {
      await deleteTranslationIfExists(request, saToken, ENTITY_TYPE, productId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
    }
  })

  test('employee can GET locales (translations.view)', async ({ request }) => {
    const employeeToken = await getAuthToken(request, 'employee')
    const response = await apiRequest(request, 'GET', '/api/translations/locales', { token: employeeToken })
    expect(response.ok()).toBeTruthy()
    const body = (await response.json()) as { locales: string[] }
    expect(Array.isArray(body.locales)).toBeTruthy()
  })

  test('employee cannot PUT translations (403 — missing translations.manage)', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const productTitle = `QA TC-TRANS-008-emp-put ${Date.now()}`
    const sku = `QA-T008-EP-${Date.now()}`
    let productId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, { title: productTitle, sku })

      const response = await apiRequest(request, 'PUT', `/api/translations/${ENTITY_TYPE}/${productId}`, {
        token: employeeToken,
        data: { de: { title: 'Should fail' } },
      })
      expect(response.status()).toBe(403)
    } finally {
      await deleteCatalogProductIfExists(request, adminToken, productId)
    }
  })

  test('employee cannot DELETE translations (403 — missing translations.manage)', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const saToken = await getAuthToken(request, 'superadmin')
    const employeeToken = await getAuthToken(request, 'employee')
    const productTitle = `QA TC-TRANS-008-emp-del ${Date.now()}`
    const sku = `QA-T008-ED-${Date.now()}`
    let productId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, { title: productTitle, sku })

      await apiRequest(request, 'PUT', `/api/translations/${ENTITY_TYPE}/${productId}`, {
        token: saToken,
        data: { de: { title: 'Cannot delete' } },
      })

      const response = await apiRequest(request, 'DELETE', `/api/translations/${ENTITY_TYPE}/${productId}`, { token: employeeToken })
      expect(response.status()).toBe(403)
    } finally {
      await deleteTranslationIfExists(request, saToken, ENTITY_TYPE, productId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
    }
  })

  test('employee cannot PUT locales (403 — missing translations.manage_locales)', async ({ request }) => {
    const employeeToken = await getAuthToken(request, 'employee')

    const response = await apiRequest(request, 'PUT', '/api/translations/locales', {
      token: employeeToken,
      data: { locales: ['en', 'de', 'fr'] },
    })
    expect(response.status()).toBe(403)
  })
})
