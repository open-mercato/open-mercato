import { expect, test, type Page } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

async function setAuthCookie(page: Page, token: string): Promise<void> {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
  await page.context().addCookies([
    {
      name: 'auth_token',
      value: token,
      url: baseUrl,
      sameSite: 'Lax',
    },
  ])
}

/**
 * TC-TRANS-009: No Translation Action for Non-Translatable CrudForm
 * Verifies that CrudForm header does not render Translation Manager action
 * for entities that are not registered as translatable.
 */
test.describe('TC-TRANS-009: No Translation Action for Non-Translatable CrudForm', () => {
  test('should not show translation action on API key create form', async ({ page, request }) => {
    // This scenario validates only translation-widget absence (not RBAC), so we use
    // superadmin to avoid environment-specific API key permission drift on admin.
    const superadminToken = await getAuthToken(request, 'superadmin')
    await setAuthCookie(page, superadminToken)
    await page.goto('/backend/api-keys/create')

    await expect(page.getByText('Create API Key')).toBeVisible()

    const translationAction = page.locator('main').getByRole('button', { name: /Translation manager/i })
    await expect(translationAction).toHaveCount(0)
  })
})
