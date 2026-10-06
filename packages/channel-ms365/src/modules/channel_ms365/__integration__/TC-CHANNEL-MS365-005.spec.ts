import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

/**
 * TC-CHANNEL-MS365-005 — "Connect Microsoft 365" is injected into the profile channels page.
 *
 * The provider package injects its connect button into the
 * `profile:communication-channels:connect` widget spot, gated by
 * `communication_channels.connect_user_channel`. Both default roles that carry
 * that feature (admin, employee) must find the button next to the Gmail / IMAP ones.
 *
 * Since #5735 the spot renders inside the page's "Connect channel" disclosure:
 * the panel stays mounted but hidden until the trigger is clicked, so the test
 * opens it first and then asserts on the provider button.
 */
const CONNECT_MENU_TRIGGER = /Connect channel|Połącz kanał|Kanal verbinden|Conectar canal|채널 연결/
const CONNECT_MS365_BUTTON = /Connect Microsoft 365|Połącz Microsoft 365|Microsoft 365 verbinden|Conectar Microsoft 365|Microsoft 365 연결/

test.describe('TC-CHANNEL-MS365-005: Connect Microsoft 365 button on the profile page', () => {
  for (const role of ['admin', 'employee'] as const) {
    test(`${role} sees the Connect Microsoft 365 button`, async ({ page }) => {
      await login(page, role)
      await page.goto('/backend/profile/communication-channels')
      const trigger = page.getByRole('button', { name: CONNECT_MENU_TRIGGER })
      await expect(trigger).toBeVisible({ timeout: 30_000 })
      await trigger.click()
      const button = page.getByRole('button', { name: CONNECT_MS365_BUTTON })
      await expect(button).toBeVisible({ timeout: 30_000 })
      await expect(button).toBeEnabled()
    })
  }
})
