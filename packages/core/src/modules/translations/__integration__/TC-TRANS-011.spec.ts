import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createCategoryFixture, deleteCatalogCategoryIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { deleteTranslationIfExists } from './helpers/translationFixtures'

const ENTITY_TYPE = 'catalog:catalog_product_category'
type UserAclResponse = {
  hasCustomAcl: boolean
  isSuperAdmin: boolean
  features: string[]
  organizations: string[] | null
}

async function openTranslationsDrawer(page: Page): Promise<Locator> {
  const openButton = page.getByRole('button', { name: /Translation manager/i }).first()
  const dialog = page.getByRole('dialog', { name: /Translations/i })

  await expect(openButton).toBeVisible()
  await expect(openButton).toBeEnabled()
  await openButton.click()
  await expect(dialog).toBeVisible()

  return dialog
}

async function waitForTranslationField(dialog: Locator, preferredPlaceholder?: string): Promise<Locator> {
  const firstEditableField = dialog.locator('table').locator('input, textarea').first()
  await expect(firstEditableField).toBeVisible()

  const normalizedPlaceholder = preferredPlaceholder?.trim()
  if (!normalizedPlaceholder) return firstEditableField

  const preferredField = dialog.getByPlaceholder(normalizedPlaceholder).first()
  if (await preferredField.count()) {
    await expect(preferredField).toBeVisible()
    return preferredField
  }

  return firstEditableField
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
 * TC-TRANS-011: RBAC UI Save Blocked Without translations.manage
 * Verifies UI save action fails for a signed-in user with translations.view but without translations.manage.
 */
test.describe('TC-TRANS-011: RBAC UI Save Blocked Without translations.manage', () => {
  test.use({ actionTimeout: 30_000 })

  test('should block translation save in UI when admin lacks translations.manage', async ({ page, request }) => {
    const saToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const adminUserId = getTokenSubject(adminToken)
    const originalUserAcl = await getUserAcl(request, saToken, adminUserId)
    const restrictedFeatures = ['catalog.*', 'attachments.view', 'translations.view', 'ai_assistant.view', 'dashboards.view']
    let categoryId: string | null = null

    try {
      const categoryName = `QA TC-TRANS-011 ${Date.now()}`
      categoryId = await createCategoryFixture(request, adminToken, { name: categoryName })

      await setUserAcl(request, saToken, {
        userId: adminUserId,
        isSuperAdmin: false,
        features: restrictedFeatures,
        organizations: null,
      })

      const restrictedAdminToken = await getAuthToken(request, 'admin')
      const permissionProbe = await apiRequest(request, 'PUT', `/api/translations/${ENTITY_TYPE}/${categoryId}`, {
        token: restrictedAdminToken,
        data: { en: { name: 'Permission Probe' } },
      })
      expect(permissionProbe.status()).toBe(403)

      await login(page, 'admin')
      await page.goto(`/backend/catalog/categories/${categoryId}/edit`)

      const dialog = await openTranslationsDrawer(page)
      const translationField = await waitForTranslationField(dialog, categoryName)
      await translationField.fill('Unauthorized Save QA')

      await dialog.getByRole('button', { name: 'Save translations' }).click()
      await expect(page).toHaveURL(/\/login\?/)
      await expect(page.getByText(/Access requires role|don't have access to this feature/i)).toBeVisible()
      await expect.poll(async () => {
        const response = await apiRequest(request, 'GET', `/api/translations/${ENTITY_TYPE}/${categoryId}`, { token: saToken })
        return response.status()
      }).toBe(404)
    } finally {
      await deleteTranslationIfExists(request, saToken, ENTITY_TYPE, categoryId).catch(() => {})
      await deleteCatalogCategoryIfExists(request, saToken, categoryId).catch(() => {})
      if (originalUserAcl.hasCustomAcl) {
        await setUserAcl(request, saToken, {
          userId: adminUserId,
          isSuperAdmin: originalUserAcl.isSuperAdmin,
          features: originalUserAcl.features,
          organizations: originalUserAcl.organizations,
        }).catch(() => {})
      } else {
        await setUserAcl(request, saToken, {
          userId: adminUserId,
          isSuperAdmin: false,
          features: [],
          organizations: null,
        }).catch(() => {})
      }
    }
  })
})
