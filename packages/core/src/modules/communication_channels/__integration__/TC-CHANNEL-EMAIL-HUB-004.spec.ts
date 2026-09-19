import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  deleteChannelIfExists,
  inspectMessageChannelLinks,
  isChannelSeedingAvailable,
  seedConnectedChannel,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

/**
 * TC-CHANNEL-EMAIL-HUB-004 — composing from a connected mailbox (#6258).
 *
 * The composer posts an optional `senderChannelId` to `POST /api/messages`. With
 * it the route delegates to the hub's send-as-user facade, so the message must
 * come out with the channel-side rows inbound threading matches on; without it
 * the platform path must stay exactly as it was.
 *
 * A connected channel can only be provisioned through the env-gated test-seed
 * fixture, so the suite skips when `OM_ENABLE_TEST_CHANNEL_SEEDING` is off.
 */
test.describe('TC-CHANNEL-EMAIL-HUB-004: compose from a connected mailbox', () => {
  test('a chosen mailbox writes the outbound link and the thread mapping', async ({ request }) => {
    const stamp = Date.now()
    let token: string | null = null
    let channelId: string | null = null

    try {
      token = await getAuthToken(request)
      const seedingAvailable = await isChannelSeedingAvailable(request, token)
      test.skip(
        !seedingAvailable,
        'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled; cannot provision a connected channel.',
      )

      channelId = await seedConnectedChannel(request, token, {
        displayName: `Composer mailbox ${stamp}`,
        externalIdentifier: `composer-${stamp}@example.com`,
      })

      const response = await apiRequest(request, 'POST', '/api/messages', {
        token,
        data: {
          type: 'default',
          visibility: 'public',
          externalEmail: `client-${stamp}@example.com`,
          subject: `Composer mailbox send ${stamp}`,
          body: 'Sent from the employee mailbox.',
          bodyFormat: 'text',
          senderChannelId: channelId,
        },
      })
      expect(
        response.status(),
        'composing with a selected mailbox should be accepted',
      ).toBe(201)

      const created = await readJsonSafe<{ id?: string; threadId?: string }>(response)
      expect(created?.id, 'compose response should carry the message id').toBeTruthy()

      const inspected = await inspectMessageChannelLinks(request, token, created!.id!)
      const outbound = inspected.links.filter((link) => link.direction === 'outbound')
      expect(outbound.length, 'an outbound MessageChannelLink should exist').toBe(1)
      expect(outbound[0].externalConversationId).toBeTruthy()

      const mapping = inspected.threadMappings.find(
        (entry) => entry.externalConversationId === outbound[0].externalConversationId,
      )
      expect(mapping, 'a ChannelThreadMapping should exist for the thread').toBeTruthy()
      expect(mapping!.channelId).toBe(channelId)
      expect(mapping!.messageThreadId).toBeTruthy()
    } finally {
      await deleteChannelIfExists(request, token, channelId)
    }
  })

  test('no mailbox selected keeps the platform path free of channel rows', async ({ request }) => {
    const stamp = Date.now()
    const token = await getAuthToken(request)
    const seedingAvailable = await isChannelSeedingAvailable(request, token)
    test.skip(!seedingAvailable, 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')

    const response = await apiRequest(request, 'POST', '/api/messages', {
      token,
      data: {
        type: 'default',
        visibility: 'public',
        externalEmail: `client-${stamp}@example.com`,
        subject: `Platform sender ${stamp}`,
        body: 'Sent from the platform sender.',
        bodyFormat: 'text',
      },
    })
    expect(response.status(), 'the platform-sender path should be unchanged').toBe(201)

    const created = await readJsonSafe<{ id?: string }>(response)
    expect(created?.id).toBeTruthy()

    const inspected = await inspectMessageChannelLinks(request, token, created!.id!)
    expect(inspected.links, 'no channel link should be written for a platform send').toEqual([])
  })

  test('a mailbox the caller does not own is refused, not silently ignored', async ({ request }) => {
    const stamp = Date.now()
    const token = await getAuthToken(request)
    const seedingAvailable = await isChannelSeedingAvailable(request, token)
    test.skip(!seedingAvailable, 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')

    const response = await apiRequest(request, 'POST', '/api/messages', {
      token,
      data: {
        type: 'default',
        visibility: 'public',
        externalEmail: `client-${stamp}@example.com`,
        subject: `Unknown mailbox ${stamp}`,
        body: 'Should not be sent.',
        bodyFormat: 'text',
        senderChannelId: '00000000-0000-0000-0000-0000000000ff',
      },
    })

    expect([403, 404, 422]).toContain(response.status())
    const body = await readJsonSafe<{ fieldErrors?: Record<string, string> }>(response)
    expect(
      body?.fieldErrors?.senderChannelId,
      'the failure should land on the composer sender field',
    ).toBeTruthy()
  })
})
