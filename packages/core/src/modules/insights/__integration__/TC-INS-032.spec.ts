import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { attachScreenshot, createUiUser, deleteUiUser, loginWithCredentials, type UiUserFixture } from './helpers/whyUi'

/**
 * TC-INS-032: access-denied page explains "Why?"
 * Covers:
 *   - UI backend catch-all access denied (AccessDeniedMessage `path` + `requiredFeatures`)
 *     → `backend:access-denied:after` → "Why can't I open this?"
 *   - GET /api/insights/explain/access?features=auth.users.list&path=/backend/users
 *
 * A user whose only role grants `insights.explain.view` opens the users page, which
 * requires `auth.users.list`; the panel reports the denial and the missing permission.
 */
test.describe('TC-INS-032: access denied page shows the "Why?" panel', () => {
  test('explains the missing permission on demand', async ({ page, request }, testInfo) => {
    let adminToken: string | null = null
    const fixture: UiUserFixture = { roleId: null, userId: null, email: null }

    try {
      adminToken = await getAuthToken(request, 'admin')
      const credentials = await createUiUser(request, adminToken, fixture, {
        label: 'INS-032',
        features: ['insights.explain.view'],
      })

      await loginWithCredentials(page, credentials.email, credentials.password)
      await page.goto('/backend/users')
      await expect(page.getByRole('alert').filter({ hasText: 'Access Denied' })).toBeVisible({ timeout: 20_000 })

      const trigger = page.getByRole('button', { name: "Why can't I open this?" })
      await expect(trigger).toHaveAttribute('aria-expanded', 'false')
      await trigger.click()
      const panel = page.getByRole('region', { name: "Why can't I open this?" })
      await expect(panel).toBeVisible()
      await expect(panel.getByText('Access denied')).toBeVisible()
      await expect(panel.getByText('auth.users.list', { exact: true })).toBeVisible()
      await expect(panel.getByText('Missing', { exact: true })).toBeVisible()
      await expect(panel.getByText('A required permission is not granted to you.')).toBeVisible()
      await attachScreenshot(page, testInfo, 'ins-032-access-why')

      await page.getByRole('button', { name: 'Hide explanation' }).click()
      await expect(panel).toHaveCount(0)
    } finally {
      await deleteUiUser(request, adminToken, fixture)
    }
  })
})
