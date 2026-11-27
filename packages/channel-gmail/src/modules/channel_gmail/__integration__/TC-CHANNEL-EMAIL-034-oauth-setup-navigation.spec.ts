import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

const sharedChannels = '/backend/communication_channels/channels'
const personalChannels = '/backend/profile/communication-channels'
const setupDetail = '/backend/integrations/channel_gmail'
const statusRoute = '**/api/communication_channels/oauth/gmail/status'
const initiateRoute = '**/api/communication_channels/oauth/gmail/initiate'

test.describe('TC-CHANNEL-EMAIL-034: Communication channel setup navigation', () => {
  test('an admin can find provider settings and recover from missing Gmail setup', async ({ page }) => {
    await login(page, 'admin')
    await page.route('**/api/communication_channels/channels?*', (route) =>
      route.fulfill({ json: { items: [], total: 0, totalPages: 1 } }),
    )
    let configured = false
    await page.route(statusRoute, (route) => route.fulfill({ json: { configured } }))
    await page.route(initiateRoute, (route) =>
      route.fulfill({ status: 409, json: { code: 'oauth_client_not_configured' } }),
    )

    await page.goto(sharedChannels)
    const configure = page.getByRole('link', { name: 'Configure providers' })
    const connectMailbox = page.getByRole('link', { name: 'Connect my mailbox' })
    await expect(configure).toHaveCount(2)
    await expect(connectMailbox).toHaveCount(2)
    const filteredMarketplace = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return url.pathname === '/api/integrations' && url.searchParams.get('category') === 'communication'
    })
    await configure.last().click()
    await expect(page).toHaveURL(/\/backend\/integrations\?category=communication$/)
    expect((await filteredMarketplace).ok()).toBe(true)

    await page.goto(sharedChannels)
    await connectMailbox.last().click()
    await expect(page).toHaveURL(new RegExp(personalChannels + '$'))
    await page.getByRole('button', { name: 'Connect channel', exact: true }).click()
    const gmail = page.getByRole('button', { name: 'Connect Gmail' })
    const setup = page.getByRole('link', { name: 'Open provider setup' }).and(page.locator(`[href="${setupDetail}"]`))
    await expect(gmail).toBeDisabled()
    await expect(setup).toHaveAttribute('href', setupDetail)
    await setup.click()
    await expect(page).toHaveURL(new RegExp(setupDetail + '$'))

    configured = true
    await page.goto(personalChannels)
    await page.getByRole('button', { name: 'Connect channel', exact: true }).click()
    await expect(gmail).toBeEnabled()
    await gmail.click()
    await expect(gmail).toBeDisabled()
    await expect(setup).toBeVisible()

    configured = false
    await page.goto(personalChannels + '?oauth=error&code=oauth_client_not_configured&provider=gmail')
    await expect(page.getByRole('alert').getByRole('link', { name: 'Open provider setup' }))
      .toHaveAttribute('href', setupDetail)
    await expect(page).toHaveURL(new RegExp(personalChannels + '$'))
  })

  test('a mailbox owner without integration access gets administrator guidance', async ({ page }) => {
    await login(page, 'employee')
    await page.route(statusRoute, (route) => route.fulfill({ json: { configured: false } }))
    await page.goto(personalChannels)

    await page.getByRole('button', { name: 'Connect channel', exact: true }).click()
    const gmail = page.getByRole('button', { name: 'Connect Gmail' })
    await expect(gmail).toBeDisabled()
    const gmailHint = page.locator(`[id="${await gmail.getAttribute('aria-describedby')}"]`)
    await expect(gmailHint.getByText(/Ask an administrator to add the OAuth Client ID and Secret/)).toBeVisible()
    await expect(gmailHint.getByRole('link', { name: 'Open provider setup' })).toHaveCount(0)
  })
})
