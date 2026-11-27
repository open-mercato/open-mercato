import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteChannelIfExists, isChannelSeedingAvailable } from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import { deleteMessageIfExists } from './helpers'
import { drainDeliveryUntil, readMessageParticipants, sendThroughSeededMailbox } from './deliveryFixtures'
import { QA_RECIPIENTS, QA_REJECT_RECIPIENT, useRaisedExternalEmailBudget } from './scheduledSendFixtures'

/**
 * TC-API-MSG-026: resend to failed recipients.
 * `POST /api/messages/[id]/resend-failed` creates a new message in the same thread
 * addressed only to the failed participants; a participant that did not fail, or a
 * message with nothing failed, answers 409.
 */
test.describe('TC-API-MSG-026: resend-failed', () => {
  useRaisedExternalEmailBudget()
  test('resends only to failed participants and refuses when nothing failed', async ({ request }) => {
    const stamp = Date.now()
    const accepted = QA_RECIPIENTS[0]
    const rejected = QA_REJECT_RECIPIENT
    let token: string | null = null
    let channelId: string | null = null
    const createdMessageIds: string[] = []

    try {
      token = await getAuthToken(request)
      test.skip(!(await isChannelSeedingAvailable(request, token)), 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')

      const sent = await sendThroughSeededMailbox(request, token, { stamp, to: [accepted, rejected], subject: `QA TC-API-MSG-026 ${stamp}` })
      channelId = sent.channelId
      createdMessageIds.push(sent.messageId)
      await drainDeliveryUntil(async () => {
        const participants = await readMessageParticipants(request, token as string, sent.messageId)
        return participants.length === 2 && participants.every((participant) => participant.deliveryStatus !== 'pending')
      }, 'the original send to settle')
      const participants = await readMessageParticipants(request, token, sent.messageId)
      const sentParticipant = participants.find((participant) => participant.email === accepted)

      const notFailed = await apiRequest(request, 'POST', `/api/messages/${encodeURIComponent(sent.messageId)}/resend-failed`, {
        token,
        data: { participantIds: [sentParticipant?.id] },
      })
      expect(notFailed.status(), 'a participant that did not fail cannot be resent').toBe(409)

      const resend = await apiRequest(request, 'POST', `/api/messages/${encodeURIComponent(sent.messageId)}/resend-failed`, { token, data: {} })
      expect(resend.status()).toBe(201)
      const created = await readJsonSafe<{ id?: string; threadId?: string }>(resend)
      expect(created?.id).toBeTruthy()
      createdMessageIds.push(created?.id as string)
      expect(created?.threadId).toBe(sent.threadId)

      const resentParticipants = await readMessageParticipants(request, token, created?.id as string)
      expect(resentParticipants.map((participant) => participant.email)).toEqual([rejected])

      const missing = await apiRequest(request, 'POST', `/api/messages/${encodeURIComponent(crypto.randomUUID())}/resend-failed`, { token, data: {} })
      expect(missing.status()).toBe(404)

      const okOnly = await sendThroughSeededMailbox(request, token, { stamp: stamp + 1, to: [QA_RECIPIENTS[0]], subject: `QA TC-API-MSG-026 ok ${stamp}` })
      createdMessageIds.push(okOnly.messageId)
      await drainDeliveryUntil(async () => {
        const current = await readMessageParticipants(request, token as string, okOnly.messageId)
        return current.length === 1 && current[0].deliveryStatus === 'sent'
      }, 'the clean send to settle')
      const nothingFailed = await apiRequest(request, 'POST', `/api/messages/${encodeURIComponent(okOnly.messageId)}/resend-failed`, { token, data: {} })
      expect(nothingFailed.status()).toBe(409)
      await deleteChannelIfExists(request, token, okOnly.channelId)
    } finally {
      for (const id of createdMessageIds) await deleteMessageIfExists(request, token, id)
      await deleteChannelIfExists(request, token, channelId)
    }
  })
})
