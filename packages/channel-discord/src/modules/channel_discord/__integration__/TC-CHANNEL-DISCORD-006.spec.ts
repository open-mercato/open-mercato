import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  deleteChannelIfExists,
  isChannelSeedingAvailable,
  seedConnectedChannel,
  seedInboundMessage,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import { drainEventsQueue } from './helpers/eventsQueue'

/**
 * TC-CHANNEL-DISCORD-006 — contact resolution for an inbound Discord message.
 * Source: .ai/specs/2026-06-19-discord-communication-channel-integration.md
 *
 * The provider deliberately ships NO contact-resolution logic: an inbound
 * Discord message reaches the CRM through the same hub event and the same
 * persistent `customers:link-channel-message-received` subscriber as e-mail.
 * This spec proves that claim end to end — a Discord-provider inbound message
 * whose sender matches a Person's stored address lands exactly one interaction
 * on that Person's timeline, attributed to the `discord` provider.
 *
 * That "exactly one" matters: a provider that duplicated the hub's linking would
 * show up here as two interactions.
 *
 * Driven via the env-gated test-seed fixture (`OM_ENABLE_TEST_CHANNEL_SEEDING`);
 * skips when the gate is off.
 */
type Interaction = {
  id: string
  interactionType: string
  title: string | null
  body: string | null
  visibility: string | null
  authorUserId: string | null
}

async function drainAndListInteractions(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  personId: string,
  timeoutMs = 20_000,
): Promise<Interaction[]> {
  const deadline = Date.now() + timeoutMs
  let last: Interaction[] = []
  while (Date.now() < deadline) {
    await drainEventsQueue()
    const response = await apiRequest(
      request,
      'GET',
      `/api/customers/interactions?entityId=${encodeURIComponent(personId)}&interactionType=email`,
      { token },
    )
    if (response.ok()) {
      const body = await readJsonSafe<{ items?: Interaction[] }>(response)
      last = Array.isArray(body?.items) ? body!.items : []
      if (last.length > 0) return last
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return last
}

test.describe('TC-CHANNEL-DISCORD-006: inbound discord message resolves to a contact', () => {
  test('an inbound discord message from a known contact creates exactly one interaction', async ({
    request,
  }) => {
    test.slow()
    let token: string | null = null
    let personId: string | null = null
    let channelId: string | null = null
    let interactionId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const seedingAvailable = await isChannelSeedingAvailable(request, token)
      test.skip(
        !seedingAvailable,
        'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot emit inbound messages.',
      )

      const stamp = Date.now()
      const senderAddress = `discord-006-sender-${stamp}@example.com`

      const person = await apiRequest(request, 'POST', '/api/customers/people', {
        token,
        data: {
          firstName: 'Discord006',
          lastName: `Contact${stamp}`,
          displayName: `Discord006 Contact ${stamp}`,
          primaryEmail: senderAddress,
        },
      })
      expect(person.ok(), 'creating the contact fixture should succeed').toBeTruthy()
      const personBody = await readJsonSafe<{ id?: string }>(person)
      personId = personBody?.id ?? null
      expect(personId, 'the person fixture must return an id').toBeTruthy()

      channelId = await seedConnectedChannel(request, token, {
        displayName: `TC-CHANNEL-DISCORD-006 ${stamp}`,
        externalIdentifier: `discord-006-${stamp}@test-seed.local`,
      })

      const subject = `Discord inbound from a known contact ${stamp}`
      const bodyText = 'this should land on the CRM timeline'
      await seedInboundMessage(request, token, {
        channelId,
        providerKey: 'discord',
        from: senderAddress,
        subject,
        bodyText,
        messageId: `discord-message-006-${stamp}`,
      })

      const items = await drainAndListInteractions(request, token, personId as string)
      expect(items.length, 'exactly one interaction must be linked to the contact').toBe(1)
      const interaction = items[0]
      interactionId = interaction.id
      expect(interaction.interactionType, 'channel messages land as email interactions').toBe('email')
      // Title + body identify THIS Discord message. The interactions list
      // projection does not expose `externalMessageId` / `channelProviderKey`,
      // so link identity and provider attribution are asserted where they are
      // written, in the hub handler's own unit tests.
      expect(interaction.title, 'the interaction must carry the discord message subject').toBe(subject)
      expect(interaction.body, 'the interaction must carry the discord message body').toBe(bodyText)
      expect(
        interaction.visibility,
        'a user-owned channel produces a private inbound interaction',
      ).toBe('private')
      expect(
        interaction.authorUserId,
        'the interaction must be authored by the channel owner, not left unattributed',
      ).toBeTruthy()
    } finally {
      if (token) {
        await deleteEntityIfExists(request, token, '/api/customers/interactions', interactionId)
      }
      await deleteChannelIfExists(request, token, channelId)
      if (token) {
        await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      }
    }
  })
})
