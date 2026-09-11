import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

/**
 * TC-CHANNEL-MS365-005 — "Connect Microsoft 365" is injected into the profile channels page.
 *
 * The provider package injects its connect button into the
 * `profile:communication-channels:connect` widget spot, gated by
 * `communication_channels.connect_user_channel`. Both default roles that carry
 * that feature (admin, employee) must see the button next to the Gmail / IMAP ones.
 */
test.describe('TC-CHANNEL-MS365-005: Connect Microsoft 365 button on the profile page', () => {
  for (const role of ['admin', 'employee'] as const) {
    test(`${role} sees the Connect Microsoft 365 button`, async ({ page }) => {
      await login(page, role)
      await page.goto('/backend/profile/communication-channels')
      const button = page.getByRole('button', { name: /Connect Microsoft 365|Połącz Microsoft 365|Microsoft 365 verbinden|Conectar Microsoft 365|Microsoft 365 연결/ })
      await expect(button).toBeVisible({ timeout: 30_000 })
      await expect(button).toBeEnabled()
    })
  }
})
