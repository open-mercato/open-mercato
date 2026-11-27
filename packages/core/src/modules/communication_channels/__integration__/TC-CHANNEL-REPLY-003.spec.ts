import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  deleteChannelIfExists,
  isChannelSeedingAvailable,
  purgeSeededInboundMessage,
  seedConnectedChannel,
  seedInboundMessage,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { SYSTEM_SENDER_USER_ID } from '@open-mercato/core/modules/messages/lib/constants'

test('requires access to both mailboxes to read a mixed-channel thread', async ({ request }) => {
  const adminToken = await getAuthToken(request, 'admin')
  test.skip(!await isChannelSeedingAvailable(request, adminToken), 'Test channel seeding is disabled.')

  const { tenantId, organizationId } = getTokenScope(adminToken)
  const threadId = randomUUID()
  let roleId: string | null = null
  let teammateId: string | null = null
  let mailboxOwnerId: string | null = null
  let mailboxOwnerToken: string | null = null
  let sharedChannelId: string | null = null
  let personalChannelId: string | null = null
  let sharedMessage: Awaited<ReturnType<typeof seedInboundMessage>> | null = null
  let personalMessage: Awaited<ReturnType<typeof seedInboundMessage>> | null = null

  function seedMessage(token: string, channelId: string, subject: string) {
    return seedInboundMessage(request, token, {
      channelId,
      subject,
      bodyText: subject,
      messageThreadId: threadId,
      createThreadMapping: true,
    })
  }

  async function useInboundMessageSource(seeded: Awaited<ReturnType<typeof seedInboundMessage>>) {
    const updated = await withClient((client) => client.query(
      `update messages
          set sender_user_id = $1, source_entity_type = 'communication_channels.external_conversation', source_entity_id = $2
        where id = $3 and tenant_id = $4 and organization_id = $5`,
      [SYSTEM_SENDER_USER_ID, seeded.conversationId, seeded.messageId, tenantId, organizationId],
    ))
    expect(updated.rowCount).toBe(1)
  }

  function getDetail(messageId: string, token: string) {
    return apiRequest(request, 'GET', `/api/messages/${messageId}?skipMarkRead=1`, { token })
  }

  try {
    roleId = await createRoleFixture(request, adminToken, { name: `qa-mailbox-reader-${threadId}`, tenantId })
    await setRoleAclFeatures(request, adminToken, {
      roleId,
      features: ['messages.view'],
      organizations: [organizationId],
    })
    const email = `qa-mailbox-reader-${threadId}@test.invalid`
    const password = `${randomUUID()}Aa1!`
    teammateId = await createUserFixture(request, adminToken, { email, password, organizationId, roles: [roleId] })
    const teammateToken = await getAuthToken(request, email, password)

    const ownerEmail = `qa-mailbox-owner-${threadId}@test.invalid`
    const ownerPassword = `${randomUUID()}Aa1!`
    mailboxOwnerId = await createUserFixture(request, adminToken, {
      email: ownerEmail,
      password: ownerPassword,
      organizationId,
      roles: ['admin'],
    })
    mailboxOwnerToken = await getAuthToken(request, ownerEmail, ownerPassword)

    sharedChannelId = await seedConnectedChannel(request, mailboxOwnerToken, {
      externalIdentifier: `shared-${threadId}@test.invalid`,
    })
    const shared = await withClient((client) => client.query(
      `update communication_channels set user_id = null, is_primary = false
        where id = $1 and tenant_id = $2 and organization_id = $3 and user_id = $4`,
      [sharedChannelId, tenantId, organizationId, mailboxOwnerId],
    ))
    expect(shared.rowCount).toBe(1)
    sharedMessage = await seedMessage(mailboxOwnerToken, sharedChannelId, 'Shared mailbox message')
    await useInboundMessageSource(sharedMessage)
    expect((await getDetail(sharedMessage.messageId, teammateToken)).status()).toBe(200)

    personalChannelId = await seedConnectedChannel(request, mailboxOwnerToken, {
      externalIdentifier: `personal-${threadId}@test.invalid`,
    })
    personalMessage = await seedMessage(mailboxOwnerToken, personalChannelId, 'Personal mailbox message')
    await useInboundMessageSource(personalMessage)

    expect((await getDetail(sharedMessage.messageId, teammateToken)).status()).toBe(403)
    expect((await getDetail(personalMessage.messageId, teammateToken)).status()).toBe(403)

    const ownerDetail = await getDetail(sharedMessage.messageId, mailboxOwnerToken)
    expect(ownerDetail.status()).toBe(200)
    const body = await readJsonSafe<{ thread: Array<{ id: string }> }>(ownerDetail)
    expect(body?.thread.map((message) => message.id)).toEqual(
      expect.arrayContaining([sharedMessage.messageId, personalMessage.messageId]),
    )
  } finally {
    await purgeSeededInboundMessage(request, mailboxOwnerToken, personalChannelId, personalMessage)
    await purgeSeededInboundMessage(request, mailboxOwnerToken, sharedChannelId, sharedMessage)
    await deleteChannelIfExists(request, mailboxOwnerToken, personalChannelId)
    await deleteUserIfExists(request, adminToken, teammateId)
    await deleteRoleIfExists(request, adminToken, roleId)
    if (sharedChannelId) {
      await withClient((client) => client.query(
        `update communication_channels set user_id = $1
          where id = $2 and tenant_id = $3 and organization_id = $4 and user_id is null`,
        [mailboxOwnerId, sharedChannelId, tenantId, organizationId],
      ))
      await deleteChannelIfExists(request, mailboxOwnerToken, sharedChannelId)
    }
    await deleteUserIfExists(request, adminToken, mailboxOwnerId)
  }
})
