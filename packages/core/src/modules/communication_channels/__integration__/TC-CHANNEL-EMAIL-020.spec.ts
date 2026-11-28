import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  deleteChannelIfExists,
  ingestInboundEmailMessage,
  isChannelSeedingAvailable,
  purgeSeededInboundMessage,
  seedConnectedChannel,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

/**
 * TC-CHANNEL-EMAIL-020 — Email rich-content widget composes cleanly with the unified inbox.
 *
 * The `channel-payload-renderer` widget renders at `detail:messages:message:body:after`
 * (slice 2a wired the spot; slice 2e wired the widget). With both email providers
 * installed (IMAP / Gmail) the messages inbox + detail pages must keep
 * returning <500 for every route the spot lives on. The inbound email fixture
 * also checks the enriched detail response and the rendered body in the inbox.
 */
test.describe('TC-CHANNEL-EMAIL-020: rich-content widget composes with messages routes', () => {
  test('GET /backend/messages does not 5xx', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(request, 'GET', '/backend/messages', { token })
    expect(response.status()).toBeLessThan(500)
  })

  test('GET /backend/messages with a synthetic id does not 5xx', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'GET',
      '/backend/messages/00000000-0000-0000-0000-000000000000',
      { token },
    )
    expect(response.status()).toBeLessThan(500)
  })

  test('serves sanitized email formatting and confines the rendered email body', async ({ request, page }) => {
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await isChannelSeedingAvailable(request, token)), 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')

    const stamp = crypto.randomUUID()
    const subject = `Monthly report ${stamp}`
    const senderAddress = `report-${stamp}@example.test`
    const rawHtml = `<p style="font-size:125%;padding:100px">${subject}</p>`
    const channelId = await seedConnectedChannel(request, token, {
      displayName: subject,
      externalIdentifier: `report-${stamp}@test-seed.local`,
    })
    let seeded: { channelLinkId: string; messageId: string; conversationId: string } | null = null
    let personId: string | null = null

    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'Report',
        lastName: 'Sender',
        displayName: `Report Sender ${stamp}`,
        primaryEmail: senderAddress,
      })
      const { status, channelLinkId, messageId, conversationId } = await ingestInboundEmailMessage(request, token, {
        channelId,
        senderAddress,
        subject,
        body: 'Monthly report summary',
        html: rawHtml,
        externalMessageId: `<report-${stamp}@example.test>`,
        externalConversationId: `inbound-seed:report-${stamp}`,
      })
      if (channelLinkId && messageId && conversationId) seeded = { channelLinkId, messageId, conversationId }
      expect(status).toBe('created')
      if (!seeded) throw new Error('[internal] Inbound email fixture is incomplete')

      const response = await apiRequest(request, 'GET', `/api/messages/${seeded.messageId}`, { token })
      expect(response.ok()).toBe(true)
      expect(await readJsonSafe(response)).toMatchObject({
        _channelPayload: { sanitizedHtml: `<p style="font-size:125%">${subject}</p>` },
      })

      await login(page, 'admin')
      await page.goto(`/backend/messages/${seeded.messageId}`)
      const email = page.getByRole('region', { name: 'Email payload' })
      const paragraph = email.getByText(subject, { exact: true })
      await expect(paragraph).toBeVisible()
      await expect(paragraph.locator('..')).toHaveCSS('contain', 'paint')
      await expect(paragraph.locator('..')).toHaveCSS('overflow-x', 'auto')
    } finally {
      await purgeSeededInboundMessage(request, token, channelId, seeded)
      await deleteChannelIfExists(request, token, channelId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})
