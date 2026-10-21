import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'
import {
  deleteChannelIfExists,
  ingestInboundChatMessage,
  isChannelSeedingAvailable,
  seedConnectedChannel,
} from '@open-mercato/core/modules/core/__integration__/helpers/communicationChannelsFixtures'
import { drainEventsQueue } from './helpers/inboundEmail'

/**
 * TC-CRM-WA-001: an inbound WhatsApp message links to the CRM person by phone.
 *
 * The hub's inbound processor stores the opaque sender handle on the Message row;
 * for chat providers that handle is an E.164 phone number. The customers
 * subscriber falls back from email addresses to that phone number and creates a
 * `message` interaction on the matching person. The adapter and webhook signature
 * are covered by the channel package's unit tests; this spec proves the CRM side
 * of the loop against real Postgres through the env-gated test-seed fixture.
 */
type InteractionRow = {
  id: string
  interactionType: string
  externalMessageId: string | null
}

test.describe('TC-CRM-WA-001: WhatsApp inbound links to the CRM timeline', () => {
  test('a phone-only sender creates one message interaction on the matching person', async ({ request }) => {
    test.slow()

    const token = await getAuthToken(request)
    const stamp = Date.now()
    const phone = `9665${String(stamp).slice(-8)}`
    let personId: string | null = null
    let channelId: string | null = null

    try {
      const seedingAvailable = await isChannelSeedingAvailable(request, token)
      test.skip(
        !seedingAvailable,
        'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot emit inbound messages.',
      )

      const personResponse = await apiRequest(request, 'POST', '/api/customers/people', {
        token,
        data: {
          firstName: 'WhatsApp',
          lastName: `Lead ${stamp}`,
          displayName: `WhatsApp Lead ${stamp}`,
          primaryPhone: phone,
        },
      })
      expect(personResponse.ok(), `POST /api/customers/people failed with ${personResponse.status()}`).toBeTruthy()
      const personBody = (await personResponse.json()) as { id?: string; entityId?: string }
      personId = personBody.id ?? personBody.entityId ?? null
      expect(personId).toBeTruthy()

      channelId = await seedConnectedChannel(request, token, {
        displayName: `TC-CRM-WA-001 channel ${stamp}`,
        providerFlavor: 'chat',
        labelAsProviderKey: 'whatsapp',
      })

      const ingested = await ingestInboundChatMessage(request, token, {
        channelId,
        senderIdentifier: phone,
        senderDisplayName: 'WhatsApp Lead',
        body: 'Hello from WhatsApp',
        externalMessageId: `wa-${stamp}`,
        externalConversationId: `whatsapp:${phone}`,
      })
      expect(ingested.status, 'the hub must accept a phone-only sender').not.toBe('rejected')

      let interactions: InteractionRow[] = []
      const deadline = Date.now() + 20_000
      while (Date.now() < deadline) {
        await drainEventsQueue()
        const response = await apiRequest(
          request,
          'GET',
          `/api/customers/interactions?entityId=${encodeURIComponent(personId as string)}&interactionType=message`,
          { token },
        )
        if (response.ok()) {
          const body = (await response.json()) as { items?: InteractionRow[] }
          interactions = body.items ?? []
          if (interactions.length) break
        }
        await new Promise((resolve) => setTimeout(resolve, 250))
      }

      expect(interactions.length, 'one message interaction must be linked to the person').toBe(1)
      expect(interactions[0].interactionType).toBe('message')
    } finally {
      await deleteChannelIfExists(request, token, channelId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})
