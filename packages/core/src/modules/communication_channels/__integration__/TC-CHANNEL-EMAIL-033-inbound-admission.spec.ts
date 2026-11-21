import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  deleteChannelIfExists,
  ingestInboundEmailMessage,
  inspectMessageChannelLinks,
  isChannelSeedingAvailable,
  purgeSeededInboundMessage,
  seedConnectedChannel,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

export const integrationMeta = {
  dependsOnModules: ['communication_channels', 'customers', 'messages'],
}

test('TC-CHANNEL-EMAIL-033: skips repeated unrelated email and admits the same email once the sender is in CRM', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  test.skip(!(await isChannelSeedingAvailable(request, token)), 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')

  const stamp = randomUUID()
  const senderAddress = `qa-inbound-${stamp}@example.test`
  const expectedSkip = { status: 'skipped', messageId: null, conversationId: null, channelLinkId: null }
  let channelId: string | null = null
  let personId: string | null = null
  let seeded: { messageId: string; conversationId: string; channelLinkId: string } | null = null

  try {
    channelId = await seedConnectedChannel(request, token, {
      displayName: `Inbound admission ${stamp}`,
      externalIdentifier: `qa-admission-${stamp}@test-seed.local`,
    })
    const inbound = {
      channelId,
      senderAddress,
      subject: `Inbound admission ${stamp}`,
      body: 'This message can be ingested once its sender has a CRM record.',
      externalMessageId: `<qa-admission-${stamp}@example.test>`,
      externalConversationId: `inbound-seed:qa-admission-${stamp}`,
    }

    for (const attempt of ['first delivery', 'repeated delivery']) {
      const result = await ingestInboundEmailMessage(request, token, inbound)
      if (result.messageId && result.conversationId && result.channelLinkId) {
        seeded = { messageId: result.messageId, conversationId: result.conversationId, channelLinkId: result.channelLinkId }
      }
      expect(result, attempt).toMatchObject(expectedSkip)
    }

    personId = await createPersonFixture(request, token, {
      firstName: 'Inbound',
      lastName: 'Sender',
      displayName: `Inbound Sender ${stamp}`,
      primaryEmail: senderAddress,
    })
    const result = await ingestInboundEmailMessage(request, token, inbound)
    if (result.messageId && result.conversationId && result.channelLinkId) {
      seeded = { messageId: result.messageId, conversationId: result.conversationId, channelLinkId: result.channelLinkId }
    }
    expect(result.status).toBe('created')
    if (!seeded) throw new Error('[internal] Inbound test ingest returned an incomplete result')

    const stored = await inspectMessageChannelLinks(request, token, seeded.messageId)
    expect(stored.links).toEqual([
      expect.objectContaining({ id: seeded.channelLinkId, direction: 'inbound', externalConversationId: seeded.conversationId }),
    ])
    expect(stored.threadMappings).toEqual([
      expect.objectContaining({ channelId, externalConversationId: seeded.conversationId }),
    ])
  } finally {
    await purgeSeededInboundMessage(request, token, channelId, seeded)
    await deleteChannelIfExists(request, token, channelId)
    await deleteEntityIfExists(request, token, '/api/customers/people', personId)
  }
})
