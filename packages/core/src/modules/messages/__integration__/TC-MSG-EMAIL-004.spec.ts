import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import {
  clearCapturedSystemEmails,
  isChannelSeedingAvailable,
  listCapturedSystemEmails,
  seedSystemEmailChannel,
  waitForCapturedSystemEmail,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import { composeMessageWithToken, deleteMessageIfExists } from './helpers'

type ParticipantRow = { email: string; deliveryStatus: string | null }

/**
 * TC-MSG-EMAIL-004 — "Send separately" delivers one system email per external address,
 * each carrying a single "to", and marks every participant as sent.
 */
test.describe('TC-MSG-EMAIL-004: send separately to multiple external recipients', () => {
  test('each address gets its own captured email', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const seedingAvailable = await isChannelSeedingAvailable(request, token)
    test.skip(!seedingAvailable, 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')

    await seedSystemEmailChannel(request, token)
    await clearCapturedSystemEmails(request, token)

    const stamp = Date.now()
    const addresses = [1, 2, 3].map((index) => `qa-message-separate-${index}-${stamp}@example.test`)
    const subject = `QA separate external message ${stamp}`
    let messageId: string | null = null

    try {
      messageId = await composeMessageWithToken(request, token, {
        visibility: 'public',
        externalEmails: addresses,
        sendSeparately: true,
        recipients: [],
        subject,
        body: 'Separate external delivery coverage.',
        sendViaEmail: true,
      })

      await drainIntegrationQueue('events')
      await drainIntegrationQueue('messages-email')

      for (const address of addresses) {
        await waitForCapturedSystemEmail(
          request,
          token,
          (email) => email.metadata?.subject === subject && email.metadata?.to === address,
          { description: `separate email to ${address}` },
        )
      }
      const captured = (await listCapturedSystemEmails(request, token))
        .filter((email) => email.metadata?.subject === subject)
      expect(captured).toHaveLength(addresses.length)

      const detailResponse = await apiRequest(request, 'GET', `/api/messages/${encodeURIComponent(messageId)}`, { token })
      expect(detailResponse.status()).toBe(200)
      const detail = (await detailResponse.json()) as { emailSendSeparately?: boolean; externalParticipants?: ParticipantRow[] }
      expect(detail.emailSendSeparately).toBe(true)
      expect((detail.externalParticipants ?? []).map((row) => [row.email, row.deliveryStatus]).sort())
        .toEqual(addresses.map((address) => [address, 'sent']).sort())
    } finally {
      await deleteMessageIfExists(request, token, messageId)
    }
  })
})
