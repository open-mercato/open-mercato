import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  deleteChannelIfExists,
  ingestInboundChatMessage,
  isChannelSeedingAvailable,
  purgeSeededInboundMessage,
  seedConnectedChannel,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'

test('TC-CHANNEL-REACTION-READ-001: reactions require readable messages', async ({ request }) => {
  const adminToken = await getAuthToken(request, 'admin')
  test.skip(!(await isChannelSeedingAvailable(request, adminToken)), 'Channel seeding is not enabled')
  const { tenantId, organizationId, userId: adminUserId } = getTokenScope(adminToken)
  const stamp = randomUUID()
  const password = `Valid1!${stamp}`
  let roleId: string | null = null
  let userId: string | null = null
  let channelId: string | null = null
  let messageId: string | null = null
  let seeded: { channelLinkId: string; messageId: string; conversationId: string } | null = null
  try {
    roleId = await createRoleFixture(request, adminToken, { name: `reaction-reader-${stamp}`, tenantId })
    await setRoleAclFeatures(request, adminToken, {
      roleId,
      features: ['messages.view', 'communication_channels.react'],
      organizations: [organizationId],
    })
    const email = `reaction-reader-${stamp}@test.invalid`
    userId = await createUserFixture(request, adminToken, {
      email, password, organizationId, roles: [roleId],
    })
    const token = await getAuthToken(request, email, password)
    channelId = await seedConnectedChannel(request, adminToken, {
      displayName: `Reaction read ${stamp}`, providerFlavor: 'chat',
    })
    const ingested = await ingestInboundChatMessage(request, adminToken, {
      channelId,
      senderIdentifier: `sender-${stamp}`,
      senderDisplayName: 'Reaction test sender',
      body: 'A shared channel message',
      externalMessageId: `message-${stamp}`,
      externalConversationId: `inbound-seed:${stamp}`,
    })
    messageId = expectId(ingested.messageId, 'Inbound message must be created')
    seeded = {
      messageId,
      channelLinkId: expectId(ingested.channelLinkId, 'Inbound channel link must be created'),
      conversationId: expectId(ingested.conversationId, 'Inbound conversation must be created'),
    }
    await withClient(async (client) => {
      await client.query('update communication_channels set user_id = null where id = $1 and tenant_id = $2', [channelId, tenantId])
    })
    const reactionPath = `/api/communication_channels/messages/${messageId}/reactions`
    const readable = await apiRequest(request, 'GET', `/api/messages/${messageId}?skipMarkRead=1`, { token })
    expect(readable.status()).toBe(200)
    const added = await apiRequest(request, 'POST', reactionPath, { token, data: { emoji: '👍' } })
    expect(added.status()).toBe(201)
    const reactionId = expectId((await readJsonSafe<{ id?: string }>(added))?.id, 'Reaction must be created')

    await withClient(async (client) => {
      await client.query('update messages set visibility = $1 where id = $2 and tenant_id = $3', ['internal', messageId, tenantId])
    })
    const unreadable = await apiRequest(request, 'GET', `/api/messages/${messageId}?skipMarkRead=1`, { token })
    expect(unreadable.status()).toBe(403)
    const deniedAdd = await apiRequest(request, 'POST', reactionPath, { token, data: { emoji: '👎' } })
    const unknownAdd = await apiRequest(request, 'POST', `/api/communication_channels/messages/${randomUUID()}/reactions`, {
      token, data: { emoji: '👎' },
    })
    expect(deniedAdd.status()).toBe(404)
    expect(unknownAdd.status()).toBe(404)
    expect(await readJsonSafe(deniedAdd)).toEqual(await readJsonSafe(unknownAdd))
    const deniedRemove = await apiRequest(request, 'DELETE', `${reactionPath}/${reactionId}`, { token })
    expect(deniedRemove.status()).toBe(404)
    await withClient(async (client) => {
      const reactions = await client.query<{ id: string }>('select id from message_reactions where message_id = $1', [messageId])
      expect(reactions.rows.map((row) => row.id)).toEqual([reactionId])
      await client.query('update messages set visibility = $1 where id = $2 and tenant_id = $3', ['public', messageId, tenantId])
    })
    const removed = await apiRequest(request, 'DELETE', `${reactionPath}/${reactionId}`, { token })
    expect(removed.status()).toBe(204)
  } finally {
    if (channelId) {
      await withClient(async (client) => {
        await client.query('update communication_channels set user_id = $1 where id = $2 and tenant_id = $3', [adminUserId, channelId, tenantId])
        if (messageId) await client.query('delete from message_reactions where message_id = $1', [messageId])
      })
    }
    await purgeSeededInboundMessage(request, adminToken, channelId, seeded)
    await deleteChannelIfExists(request, adminToken, channelId)
    await deleteUserIfExists(request, adminToken, userId)
    await deleteRoleIfExists(request, adminToken, roleId)
  }
})
