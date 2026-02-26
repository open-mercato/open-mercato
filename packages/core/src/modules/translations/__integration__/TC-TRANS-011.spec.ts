import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createCategoryFixture, deleteCatalogCategoryIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import { deleteTranslationIfExists } from './helpers/translationFixtures'

const ENTITY_TYPE = 'catalog:catalog_product_category'
type UserAclResponse = {
  hasCustomAcl: boolean
  isSuperAdmin: boolean
  features: string[]
  organizations: string[] | null
}

function getTokenSubject(token: string): string {
  const payload = token.split('.')[1]
  if (!payload) throw new Error('Invalid auth token payload')
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub?: string }
  if (typeof decoded.sub !== 'string' || !decoded.sub) throw new Error('Missing token subject')
  return decoded.sub
}

async function getUserAcl(request: APIRequestContext, token: string, userId: string): Promise<UserAclResponse> {
  const response = await apiRequest(request, 'GET', `/api/auth/users/acl?userId=${encodeURIComponent(userId)}`, { token })
  expect(response.ok()).toBeTruthy()
  const body = (await response.json()) as Partial<UserAclResponse>
  return {
    hasCustomAcl: !!body.hasCustomAcl,
    isSuperAdmin: !!body.isSuperAdmin,
    features: Array.isArray(body.features) ? body.features : [],
    organizations: Array.isArray(body.organizations) ? body.organizations : null,
  }
}

async function setUserAcl(
  request: APIRequestContext,
  token: string,
  payload: { userId: string; isSuperAdmin: boolean; features: string[]; organizations: string[] | null },
): Promise<void> {
  const response = await apiRequest(request, 'PUT', '/api/auth/users/acl', {
    token,
    data: {
      userId: payload.userId,
      isSuperAdmin: payload.isSuperAdmin,
      features: payload.features,
      organizations: payload.organizations,
    },
  })
  expect(response.ok()).toBeTruthy()
}

/**
 * TC-TRANS-011: RBAC Save Blocked Without translations.manage
 * Verifies that a user with translations.view but without translations.manage
 * can read translation locales but cannot persist translation changes.
 */
test.describe('TC-TRANS-011: RBAC Save Blocked Without translations.manage', () => {
  test('should allow viewing locales but block saving translations', async ({ request }) => {
    const saToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const adminUserId = getTokenSubject(adminToken)
    const originalUserAcl = await getUserAcl(request, saToken, adminUserId)
    let categoryId: string | null = null

    try {
      const categoryName = `QA TC-TRANS-011 ${Date.now()}`
      categoryId = await createCategoryFixture(request, adminToken, { name: categoryName })

      await setUserAcl(request, saToken, {
        userId: adminUserId,
        isSuperAdmin: false,
        features: ['catalog.*', 'translations.view'],
        organizations: null,
      })

      const restrictedToken = await getAuthToken(request, 'admin')

      // Restricted admin CAN view translation locales (translations.view grants read)
      const localesProbe = await apiRequest(request, 'GET', '/api/translations/locales', { token: restrictedToken })
      expect(localesProbe.ok()).toBeTruthy()

      // Restricted admin CAN read translations for a record
      const readProbe = await apiRequest(request, 'GET', `/api/translations/${ENTITY_TYPE}/${categoryId}`, { token: restrictedToken })
      expect([200, 404]).toContain(readProbe.status())

      // Restricted admin CANNOT save translations (requires translations.manage)
      const saveProbe = await apiRequest(request, 'PUT', `/api/translations/${ENTITY_TYPE}/${categoryId}`, {
        token: restrictedToken,
        data: { en: { name: 'Unauthorized Save QA' } },
      })
      expect(saveProbe.status()).toBe(403)

      // Verify no translation was persisted
      const verifyResponse = await apiRequest(request, 'GET', `/api/translations/${ENTITY_TYPE}/${categoryId}`, { token: saToken })
      expect(verifyResponse.status()).toBe(404)
    } finally {
      // CRITICAL: restore admin ACL FIRST to prevent cascading 403s in subsequent tests
      await setUserAcl(request, saToken, {
        userId: adminUserId,
        isSuperAdmin: originalUserAcl.isSuperAdmin,
        features: originalUserAcl.features,
        organizations: originalUserAcl.organizations,
      }).catch(() => {})
      await deleteTranslationIfExists(request, saToken, ENTITY_TYPE, categoryId).catch(() => {})
      await deleteCatalogCategoryIfExists(request, saToken, categoryId).catch(() => {})
    }
  })
})
