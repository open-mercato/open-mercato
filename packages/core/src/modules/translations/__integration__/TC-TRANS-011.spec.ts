import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createCategoryFixture, deleteCatalogCategoryIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import { deleteTranslationIfExists } from './helpers/translationFixtures'

const ENTITY_TYPE = 'catalog:catalog_product_category'
type RoleAclResponse = {
  isSuperAdmin: boolean
  features: string[]
  organizations: string[] | null
}

async function findRoleId(request: APIRequestContext, token: string, roleName: string): Promise<string> {
  const response = await apiRequest(request, 'GET', `/api/auth/roles?search=${encodeURIComponent(roleName)}&pageSize=50`, { token })
  expect(response.ok()).toBeTruthy()
  const body = (await response.json()) as { items?: Array<{ id: string; name: string }> }
  const role = (body.items ?? []).find((item) => item.name === roleName)
  if (!role) throw new Error(`Role ${roleName} not found`)
  return role.id
}

async function getRoleAcl(request: APIRequestContext, token: string, roleId: string): Promise<RoleAclResponse> {
  const response = await apiRequest(request, 'GET', `/api/auth/roles/acl?roleId=${encodeURIComponent(roleId)}`, { token })
  expect(response.ok()).toBeTruthy()
  const body = (await response.json()) as Partial<RoleAclResponse>
  return {
    isSuperAdmin: !!body.isSuperAdmin,
    features: Array.isArray(body.features) ? body.features : [],
    organizations: Array.isArray(body.organizations) ? body.organizations : null,
  }
}

async function setRoleAcl(
  request: APIRequestContext,
  token: string,
  payload: { roleId: string; isSuperAdmin: boolean; features: string[]; organizations: string[] | null },
): Promise<void> {
  const response = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
    token,
    data: {
      roleId: payload.roleId,
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
    const adminRoleId = await findRoleId(request, saToken, 'admin')
    const originalAdminRoleAcl = await getRoleAcl(request, saToken, adminRoleId)
    let categoryId: string | null = null

    try {
      const categoryName = `QA TC-TRANS-011 ${Date.now()}`
      categoryId = await createCategoryFixture(request, adminToken, { name: categoryName })

      const restrictedFeatures = Array.from(new Set([
        ...originalAdminRoleAcl.features.filter((feature) =>
          feature !== '*' &&
          feature !== 'translations.*' &&
          feature !== 'translations.manage' &&
          feature !== 'translations.manage_locales' &&
          !feature.startsWith('translations.')
        ),
        'translations.view',
      ]))

      await setRoleAcl(request, saToken, {
        roleId: adminRoleId,
        isSuperAdmin: false,
        features: restrictedFeatures,
        organizations: originalAdminRoleAcl.organizations,
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
      await setRoleAcl(request, saToken, {
        roleId: adminRoleId,
        isSuperAdmin: originalAdminRoleAcl.isSuperAdmin,
        features: originalAdminRoleAcl.features,
        organizations: originalAdminRoleAcl.organizations,
      }).catch(() => {})
      await deleteTranslationIfExists(request, saToken, ENTITY_TYPE, categoryId).catch(() => {})
      await deleteCatalogCategoryIfExists(request, saToken, categoryId).catch(() => {})
    }
  })
})
