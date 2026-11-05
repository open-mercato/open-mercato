import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'

test.describe('TC-SEC-001: MFA enrollment redirect notice', () => {
  test.describe.configure({ timeout: 90_000 })

  test.beforeEach(async ({ page }) => {
    await login(page, 'admin')
  })

  test('shows enrollment notice, clears consumed params, and dismiss keeps user on MFA page', async ({ page }) => {
    await page.goto('/backend/profile/security/mfa?redirect=%2Fbackend&reason=mfa_enrollment_required')
    await page.waitForLoadState('domcontentloaded')

    await expect(page.getByText('MFA enrollment required')).toBeVisible()

    await expect.poll(() => {
      const url = new URL(page.url())
      return {
        reason: url.searchParams.get('reason'),
        overdue: url.searchParams.get('overdue'),
        redirect: url.searchParams.get('redirect'),
      }
    }).toEqual({ reason: null, overdue: null, redirect: null })

    await page.getByRole('button', { name: 'Dismiss' }).click()
    await expect(page.getByText('MFA enrollment required')).not.toBeVisible()
    await expect(page).toHaveURL(/\/backend\/profile\/security\/mfa$/)
  })

  test('renders overdue warning copy when overdue=1', async ({ page }) => {
    await page.goto('/backend/profile/security/mfa?redirect=%2Fbackend&reason=mfa_enrollment_required&overdue=1')
    await page.waitForLoadState('domcontentloaded')

    await expect(page.getByText('MFA enrollment required')).toBeVisible()
    await expect(page.getByText(
      'Your MFA enrollment deadline has passed. Set up MFA now to keep account access.',
    )).toBeVisible()
  })

  test('does not render enrollment notice when reason token is missing', async ({ page }) => {
    await page.goto('/backend/profile/security/mfa?redirect=%2Fbackend')
    await page.waitForLoadState('domcontentloaded')

    await expect(page.getByText('MFA enrollment required')).not.toBeVisible()
  })
})

