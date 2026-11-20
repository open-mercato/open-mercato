import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { deleteChannelIfExists, isChannelSeedingAvailable } from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { deleteMessageIfExists } from './helpers'
import { drainDeliveryUntil, readMessageParticipants, sendThroughSeededMailbox } from './deliveryFixtures'
import { QA_RATELIMIT_RECIPIENT } from './scheduledSendFixtures'

/**
 * TC-API-MSG-027: a transient 429 with a retry time keeps the participant pending.
 * The provider answers 429 with a retry time two minutes ahead: the participant stays
 * `pending`, carries the error, and `next_attempt_at` is the provider's retry time.
 */
test.describe('TC-API-MSG-027: transient rate limit', () => {
  test('keeps the participant pending with next_attempt_at from the provider retry time', async ({ request }) => {
    const stamp = Date.now()
    const recipient = QA_RATELIMIT_RECIPIENT
    let token: string | null = null
    let channelId: string | null = null
    let messageId: string | null = null

    try {
      token = await getAuthToken(request)
      test.skip(!(await isChannelSeedingAvailable(request, token)), 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')

      const before = Date.now()
      const sent = await sendThroughSeededMailbox(request, token, { stamp, to: [recipient], subject: `QA TC-API-MSG-027 ${stamp}` })
      channelId = sent.channelId
      messageId = sent.messageId

      await drainDeliveryUntil(async () => {
        const participants = await readMessageParticipants(request, token as string, sent.messageId)
        return Boolean(participants[0]?.deliveryError)
      }, 'the rate-limited attempt to be recorded')

      const participants = await readMessageParticipants(request, token, sent.messageId)
      expect(participants[0]?.deliveryStatus).toBe('pending')
      expect(participants[0]?.deliveryError).toContain('429')

      const nextAttemptAt = await withClient(async (client) => {
        const result = await client.query<{ next_attempt_at: Date | null }>(
          'select next_attempt_at from message_external_participants where message_id = $1',
          [sent.messageId],
        )
        return result.rows[0]?.next_attempt_at ?? null
      })
      expect(nextAttemptAt).not.toBeNull()
      const delayMs = (nextAttemptAt as Date).getTime() - before
      expect(delayMs).toBeGreaterThan(60_000)
      expect(delayMs).toBeLessThan(10 * 60_000)
    } finally {
      await deleteMessageIfExists(request, token, messageId)
      await deleteChannelIfExists(request, token, channelId)
    }
  })
})
