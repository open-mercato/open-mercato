import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  deleteChannelIfExists,
  isChannelSeedingAvailable,
  purgeSeededInboundMessage,
  seedConnectedChannel,
  seedInboundMessage,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['communication_channels', 'messages'],
  requiredEnvVars: ['OM_ENABLE_TEST_CHANNEL_SEEDING'],
}

test('TC-CHANNEL-REACTION-IDEMPOTENCY-001: concurrent identical reaction adds share one row', async ({ request }) => {
  const token = await getAuthToken(request)
  test.skip(!await isChannelSeedingAvailable(request, token), 'Channel fixture seeding is disabled.')
  const { organizationId, tenantId, userId } = getTokenScope(token)
  const stamp = randomUUID()
  const address = `reaction-idempotency-${stamp}@test-seed.local`
  const channelId = await seedConnectedChannel(request, token, { externalIdentifier: address })
  let seeded: Awaited<ReturnType<typeof seedInboundMessage>> | null = null

  try {
    seeded = await seedInboundMessage(request, token, {
      channelId,
      from: `sender-${stamp}@example.com`,
      to: [address],
      subject: 'Concurrent reaction fixture',
      createThreadMapping: true,
    })
    const { messageId } = seeded
    const path = `/api/communication_channels/messages/${messageId}/reactions`
    const emoji = '👍'
    const post = () => apiRequest(request, 'POST', path, { token, data: { emoji } })
    const responses = await Promise.all([post(), post()])
    const [created, repeated] = responses.sort((left, right) => right.status() - left.status())
    expect(created.status()).toBe(201)
    expect(repeated.status()).toBe(200)

    const reaction = await readJsonSafe<{ id?: string }>(created)
    const id = expectId(reaction?.id, 'creation returns the reaction id')
    expect(reaction).toEqual({ id, messageId, emoji, replaced: 0, enqueued: true })
    expect(await readJsonSafe(repeated)).toEqual({ id, messageId, emoji, replaced: 0, enqueued: false })

    const rows = await withClient((client) => client.query<{ id: string }>(
      `select id from message_reactions
       where message_id = $1 and tenant_id = $2 and organization_id = $3 and reacted_by_user_id = $4`,
      [messageId, tenantId, organizationId, userId],
    ))
    expect(rows.rows).toEqual([{ id }])
  } finally {
    try {
      const messageId = seeded?.messageId
      if (messageId) {
        await withClient((client) => client.query(
          `delete from message_reactions
           where message_id = $1 and tenant_id = $2 and organization_id = $3 and reacted_by_user_id = $4`,
          [messageId, tenantId, organizationId, userId],
        ))
      }
    } finally {
      await purgeSeededInboundMessage(request, token, channelId, seeded)
      await deleteChannelIfExists(request, token, channelId)
    }
  }
})
