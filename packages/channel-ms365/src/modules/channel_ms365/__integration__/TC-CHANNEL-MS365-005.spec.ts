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
 *
 * Since #10365 the button checks the workspace OAuth setup first: it stays
 * disabled with a setup hint until Microsoft 365 credentials are saved. The
 * status route is stubbed so both states are covered without real credentials;
 * the hint is located through the button's `aria-describedby`, because the
 * Gmail button renders the same hint text.
 */
const CONNECT_MENU_TRIGGER = /Connect channel|Połącz kanał|Kanal verbinden|Conectar canal|채널 연결/
const CONNECT_MS365_BUTTON = /Connect Microsoft 365|Połącz Microsoft 365|Microsoft 365 verbinden|Conectar Microsoft 365|Microsoft 365 연결/
const PERSONAL_CHANNELS = '/backend/profile/communication-channels'
const STATUS_ROUTE = '**/api/communication_channels/oauth/ms365/status'
const SETUP_DETAIL = '/backend/integrations/channel_ms365'

test.describe('TC-CHANNEL-MS365-005: Connect Microsoft 365 button on the profile page', () => {
  for (const role of ['admin', 'employee'] as const) {
    test(`${role} sees the Connect Microsoft 365 button, enabled once the workspace is set up`, async ({ page }) => {
      let configured = false
      await page.route(STATUS_ROUTE, (route) => route.fulfill({ json: { configured } }))
      await login(page, role)

      const openConnectMenu = async () => {
        await page.goto(PERSONAL_CHANNELS)
        const trigger = page.getByRole('button', { name: CONNECT_MENU_TRIGGER })
        await expect(trigger).toBeVisible({ timeout: 30_000 })
        await trigger.click()
      }

      await openConnectMenu()
      const button = page.getByRole('button', { name: CONNECT_MS365_BUTTON })
      await expect(button).toBeVisible({ timeout: 30_000 })
      await expect(button).toBeDisabled()
      const hint = page.locator(`[id="${await button.getAttribute('aria-describedby')}"]`)
      await expect(hint.getByRole('status')).toHaveCount(0)
      if (role === 'admin') {
        await expect(hint.getByRole('link')).toHaveAttribute('href', SETUP_DETAIL)
      } else {
        await expect(hint).toBeVisible()
        await expect(hint.getByRole('link')).toHaveCount(0)
      }

      configured = true
      await openConnectMenu()
      await expect(button).toBeEnabled()
    })
  }
})
