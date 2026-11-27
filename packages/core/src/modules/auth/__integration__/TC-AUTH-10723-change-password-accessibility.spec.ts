import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

test('change password identifies each input and exposes the new password requirements', async ({ page }) => {
  await login(page)
  await page.goto('/backend/profile/change-password')

  const currentPassword = page.getByLabel('Current password', { exact: true })
  const newPassword = page.getByLabel('New password', { exact: true })
  const confirmPassword = page.getByLabel('Confirm new password', { exact: true })

  await expect(currentPassword).toHaveAttribute('autocomplete', 'current-password')
  await expect(newPassword).toHaveAttribute('autocomplete', 'new-password')
  await expect(confirmPassword).toHaveAttribute('autocomplete', 'new-password')
  await expect(newPassword).toHaveAccessibleDescription(/^Password requirements: \S/)
})
