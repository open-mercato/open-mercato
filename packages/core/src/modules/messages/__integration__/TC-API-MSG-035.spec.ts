import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { deleteChannelIfExists, inspectMessageChannelLinks, isChannelSeedingAvailable } from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import { deleteMessageIfExists } from './helpers'
import { drainDeliveryUntil, readMessageParticipants, sendThroughSeededMailbox } from './deliveryFixtures'
import { QA_RECIPIENTS, QA_REJECT_RECIPIENT, useRaisedExternalEmailBudget } from './scheduledSendFixtures'

/**
 * TC-API-MSG-035: a partially rejected send is a sent message with failed participants.
 * The relay accepts one address and rejects the other: the link is `sent`, the accepted
 * participant `sent`, the rejected one `failed` with the provider error.
 */
test.describe('TC-API-MSG-035: partial rejection', () => {
  useRaisedExternalEmailBudget()
  test('marks only the rejected participant failed', async ({ request }) => {
    const stamp = Date.now()
    const accepted = QA_RECIPIENTS[0]
    const rejected = QA_REJECT_RECIPIENT
    let token: string | null = null
    let channelId: string | null = null
    let messageId: string | null = null

    try {
      token = await getAuthToken(request)
      test.skip(!(await isChannelSeedingAvailable(request, token)), 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')

      const sent = await sendThroughSeededMailbox(request, token, { stamp, to: [accepted, rejected], subject: `QA TC-API-MSG-035 ${stamp}` })
      channelId = sent.channelId
      messageId = sent.messageId

      await drainDeliveryUntil(async () => {
        const participants = await readMessageParticipants(request, token as string, sent.messageId)
        return participants.length === 2 && participants.every((participant) => participant.deliveryStatus !== 'pending')
      }, 'both participants to settle')

      const participants = await readMessageParticipants(request, token, sent.messageId)
      expect(participants.find((participant) => participant.email === accepted)?.deliveryStatus).toBe('sent')
      const failed = participants.find((participant) => participant.email === rejected)
      expect(failed?.deliveryStatus).toBe('failed')
      expect(failed?.deliveryError).toContain('TEST_SEED_PARTIALLY_REJECTED')

      const links = await inspectMessageChannelLinks(request, token, sent.messageId)
      expect(links.links.filter((link) => link.direction === 'outbound').map((link) => link.deliveryStatus)).toEqual(['sent'])
    } finally {
      await deleteMessageIfExists(request, token, messageId)
      await deleteChannelIfExists(request, token, channelId)
    }
  })
})
