import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

/**
 * TC-CHANNEL-DISCORD-014 — the Connect Discord dialog is an embedded CrudForm
 * with setup hints (#5592).
 *
 * Opens the dialog from Profile → My communication channels and asserts that
 * every credential field carries the same help text the Integrations → Discord
 * credentials form shows, and that an empty or malformed submit is stopped
 * client-side with inline field errors — no request reaches the connect route,
 * so no channel is created and the test needs no fixture or cleanup.
 */
test.describe('TC-CHANNEL-DISCORD-014: Connect Discord dialog', () => {
  test('shows field hints and validates inline before sending anything', async ({ page }) => {
    await login(page, 'admin')

    const connectRequests: string[] = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/channels/connect/credentials')) {
        connectRequests.push(request.url())
      }
    })

    await page.goto('/backend/profile/communication-channels')
    await page.locator('#communication-channels-connect-trigger').click()
    await page.getByRole('button', { name: 'Connect Discord' }).click()

    const dialog = page.getByRole('dialog', { name: 'Connect Discord bot' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Developer Portal → Applications → your app → Bot → Reset Token.', { exact: false })).toBeVisible()
    await expect(dialog.getByText('Developer Portal → General Information → Application ID.', { exact: false })).toBeVisible()
    await expect(dialog.getByText('Developer Portal → General Information → Public Key.', { exact: false })).toBeVisible()
    await expect(dialog.getByText('Enable Developer Mode in Discord, right-click the server, Copy Server ID.', { exact: false })).toBeVisible()

    await dialog.getByRole('button', { name: 'Connect', exact: true }).click()
    await expect(dialog.getByText('This field is required.')).toHaveCount(3)

    await dialog.locator('[data-crud-field-id="botToken"] input').fill('not-a-real-token')
    await dialog.locator('[data-crud-field-id="applicationId"] input').fill('123456789012345678')
    await dialog.locator('[data-crud-field-id="publicKey"] input').fill('not-hex')
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click()
    await expect(dialog.getByText('Enter the 64-character hex public key from the Developer Portal.')).toBeVisible()
    await expect(dialog.getByText('This field is required.')).toHaveCount(0)

    expect(connectRequests, 'client-side validation must stop the request').toEqual([])
  })
})
