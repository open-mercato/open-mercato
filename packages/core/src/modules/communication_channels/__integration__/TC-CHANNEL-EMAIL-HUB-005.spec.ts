import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  deleteChannelIfExists,
  inspectMessageChannelLinks,
  isChannelSeedingAvailable,
  seedConnectedChannel,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'

export const integrationMeta = {
  dependsOnModules: ['communication_channels', 'customers', 'messages'],
  requiredEnvVars: ['OM_ENABLE_TEST_CHANNEL_SEEDING'],
}

type ComposedEmail = { messageId: string; threadId: string }
type EmailMessage = {
  id: string
  messageId: string | null
  rfcMessageId: string | null
  references: string[]
  authoredByViewer: boolean
  authorName: string | null
}
type EmailThread = { threadKey: string; messages: EmailMessage[] }
type EmailInteraction = {
  id: string
  externalMessageId: string | null
  authorUserId: string | null
  channelId: string | null
  visibility: string | null
}

async function fetchThreads(request: APIRequestContext, token: string, personId: string): Promise<EmailThread[]> {
  const response = await apiRequest(request, 'GET', `/api/customers/people/${personId}/email-threads`, { token })
  expect(response.status(), 'email threads should be readable').toBe(200)
  const body = await readJsonSafe<{ threads?: EmailThread[] }>(response)
  return body?.threads ?? []
}

async function fetchInteractions(request: APIRequestContext, token: string, personId: string): Promise<EmailInteraction[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/customers/interactions?entityId=${personId}&interactionType=email`,
    { token },
  )
  expect(response.status(), 'email interactions should be readable').toBe(200)
  const body = await readJsonSafe<{ items?: EmailInteraction[] }>(response)
  return body?.items ?? []
}

async function setShared(request: APIRequestContext, token: string, personId: string, shared: boolean): Promise<void> {
  const response = await apiRequest(request, 'PUT', `/api/customers/people/${personId}/email-share`, {
    token,
    data: { shared },
  })
  expect(response.status(), 'changing conversation sharing should succeed').toBe(200)
}

async function composeEmail(
  request: APIRequestContext,
  input: {
    token: string
    personId: string
    channelId: string
    recipient: string
    subject: string
    parent?: EmailMessage
  },
): Promise<ComposedEmail> {
  const response = await apiRequest(request, 'POST', `/api/customers/people/${input.personId}/emails`, {
    token: input.token,
    data: {
      userChannelId: input.channelId,
      to: [input.recipient],
      subject: input.subject,
      body: `Body for ${input.subject}`,
      bodyFormat: 'text',
      visibility: 'private',
      ...(input.parent
        ? {
            parentMessageId: input.parent.messageId,
            inReplyTo: input.parent.rfcMessageId,
            references: [...input.parent.references, input.parent.rfcMessageId],
          }
        : {}),
    },
  })
  expect(response.status(), 'private email should be queued').toBe(200)
  const body = await readJsonSafe<Partial<ComposedEmail>>(response)
  return {
    messageId: expectId(body?.messageId, 'compose should return its platform message id'),
    threadId: expectId(body?.threadId, 'compose should return its platform thread id'),
  }
}

async function drainEmailQueues(): Promise<void> {
  await drainIntegrationQueue('events')
  await drainIntegrationQueue('communication-channels-outbound')
  await drainIntegrationQueue('events')
}

async function readExternalMessage(messageId: string, scope: { tenantId: string; organizationId: string }) {
  return withClient(async (client) => {
    const result = await client.query<{ channelId: string; conversationId: string; direction: string }>(
      `select external.channel_id as "channelId", external.conversation_id as "conversationId", external.direction
       from external_messages external
       join message_channel_links link on link.external_message_id = external.id
       where link.message_id = $1 and link.tenant_id = $2 and link.organization_id = $3
         and external.tenant_id = $2 and external.organization_id = $3`,
      [messageId, scope.tenantId, scope.organizationId],
    )
    return result.rows
  })
}

test.describe('TC-CHANNEL-EMAIL-HUB-005: a shared conversation reply uses the selected mailbox', () => {
  test.beforeAll(async () => {
    if (!process.env.OM_TEST_APP_ROOT?.trim()) await drainIntegrationQueue('events')
  })

  test('the teammate owns their private reply after the original author revokes sharing', async ({ request }) => {
    test.slow()
    const stamp = randomUUID()
    const recipient = `channel-hub-005-person-${stamp}@example.com`
    const userAName = `QA Channel Hub 005 A ${stamp}`
    let adminToken: string | null = null
    let userAToken: string | null = null
    let userBToken: string | null = null
    let userAId: string | null = null
    let userBId: string | null = null
    let roleId: string | null = null
    let personId: string | null = null
    let channelAId: string | null = null
    let channelBId: string | null = null
    let original: ComposedEmail | null = null
    let reply: ComposedEmail | null = null
    const interactionIds = new Set<string>()

    try {
      adminToken = await getAuthToken(request)
      test.skip(
        !await isChannelSeedingAvailable(request, adminToken),
        'OM_ENABLE_TEST_CHANNEL_SEEDING is disabled; connected test mailboxes cannot be provisioned.',
      )
      const scope = getTokenScope(adminToken)
      const roleName = `qa_channel_hub_005_${stamp}`
      roleId = await createRoleFixture(request, adminToken, { name: roleName, tenantId: scope.tenantId })
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: [
          'customers.people.view',
          'customers.interactions.view',
          'customers.email.compose',
          'customers.email.share_conversation',
          'communication_channels.connect_user_channel',
          'messages.view',
        ],
      })

      const userAEmail = `channel-hub-005-a-${stamp}@example.com`
      const userBEmail = `channel-hub-005-b-${stamp}@example.com`
      const userAPassword = `Qa1!${randomUUID()}`
      const userBPassword = `Qa1!${randomUUID()}`
      userAId = await createUserFixture(request, adminToken, {
        email: userAEmail,
        password: userAPassword,
        organizationId: scope.organizationId,
        roles: [roleName],
        name: userAName,
      })
      userBId = await createUserFixture(request, adminToken, {
        email: userBEmail,
        password: userBPassword,
        organizationId: scope.organizationId,
        roles: [roleName],
        name: `QA Channel Hub 005 B ${stamp}`,
      })
      userAToken = await getAuthToken(request, userAEmail, userAPassword)
      userBToken = await getAuthToken(request, userBEmail, userBPassword)
      channelAId = await seedConnectedChannel(request, userAToken, { externalIdentifier: userAEmail })
      channelBId = await seedConnectedChannel(request, userBToken, { externalIdentifier: userBEmail })
      personId = await createPersonFixture(request, adminToken, {
        firstName: 'Mailbox',
        lastName: stamp,
        displayName: `Mailbox reply person ${stamp}`,
        primaryEmail: recipient,
      })

      original = await composeEmail(request, {
        token: userAToken,
        personId,
        channelId: channelAId,
        recipient,
        subject: `Original ${stamp}`,
      })
      await drainEmailQueues()
      const originalLinks = await inspectMessageChannelLinks(request, userAToken, original.messageId)
      expect(originalLinks.links).toHaveLength(1)
      const originalLink = originalLinks.links[0]
      expect(originalLink.deliveryStatus).toBe('sent')
      expect(await readExternalMessage(original.messageId, scope)).toEqual([
        { channelId: channelAId, conversationId: originalLink.externalConversationId, direction: 'outbound' },
      ])
      for (const interaction of await fetchInteractions(request, userAToken, personId)) interactionIds.add(interaction.id)
      expect((await fetchThreads(request, userBToken, personId)).flatMap((thread) => thread.messages)).toEqual([])

      await setShared(request, userAToken, personId, true)
      const sharedOriginal = (await fetchThreads(request, userBToken, personId))
        .flatMap((thread) => thread.messages)
        .find((message) => message.id === originalLink.id)
      expect(sharedOriginal, 'the teammate should see the original shared email').toBeDefined()
      expect(sharedOriginal?.messageId).toBe(original.messageId)
      expect(sharedOriginal?.rfcMessageId).toBeTruthy()
      expect(sharedOriginal?.authoredByViewer).toBe(false)
      expect(sharedOriginal?.authorName).toBe(userAName)

      reply = await composeEmail(request, {
        token: userBToken,
        personId,
        channelId: channelBId,
        recipient,
        subject: `Re: Original ${stamp}`,
        parent: sharedOriginal!,
      })
      expect(reply.threadId, 'replying should retain the existing platform thread').toBe(original.threadId)
      await drainEmailQueues()

      const replyLinks = await inspectMessageChannelLinks(request, userBToken, reply.messageId)
      expect(replyLinks.links).toHaveLength(1)
      const replyLink = replyLinks.links[0]
      expect(replyLink.deliveryStatus).toBe('sent')
      expect(replyLink.externalConversationId).not.toBe(originalLink.externalConversationId)
      expect(replyLinks.threadMappings).toEqual([
        expect.objectContaining({
          messageThreadId: original.threadId,
          channelId: channelBId,
          externalConversationId: replyLink.externalConversationId,
        }),
      ])
      expect(
        await readExternalMessage(reply.messageId, scope),
        'delivery must persist the reply under the selected teammate mailbox',
      ).toEqual([
        { channelId: channelBId, conversationId: replyLink.externalConversationId, direction: 'outbound' },
      ])

      const replyInteraction = (await fetchInteractions(request, userBToken, personId))
        .find((interaction) => interaction.externalMessageId === replyLink.id)
      expect(replyInteraction, 'delivery should create a CRM interaction for the reply').toBeDefined()
      interactionIds.add(replyInteraction!.id)
      expect(replyInteraction).toMatchObject({ authorUserId: userBId, channelId: channelBId, visibility: 'private' })
      const replyThreads = await fetchThreads(request, userBToken, personId)
      expect(replyThreads.find((thread) => thread.messages.some((message) => message.id === replyLink.id))?.messages)
        .toEqual(expect.arrayContaining([
          expect.objectContaining({ id: originalLink.id }),
          expect.objectContaining({ id: replyLink.id, authoredByViewer: true, authorName: null }),
        ]))

      await setShared(request, userAToken, personId, false)
      const remainingMessages = (await fetchThreads(request, userBToken, personId)).flatMap((thread) => thread.messages)
      expect(remainingMessages.map((message) => message.id)).toEqual([replyLink.id])
      expect(remainingMessages[0].authoredByViewer).toBe(true)
      const remainingInteractions = await fetchInteractions(request, userBToken, personId)
      expect(remainingInteractions.map((interaction) => interaction.id)).toEqual([replyInteraction!.id])
      expect(remainingInteractions[0]).toMatchObject({ authorUserId: userBId, channelId: channelBId, visibility: 'private' })
      expect((await fetchThreads(request, userAToken, personId)).flatMap((thread) => thread.messages).map((message) => message.id))
        .toEqual([originalLink.id])
    } finally {
      if (personId && userAToken) await setShared(request, userAToken, personId, false).catch(() => undefined)
      if (personId) {
        for (const token of [userAToken, userBToken]) {
          if (!token) continue
          for (const interaction of await fetchInteractions(request, token, personId).catch(() => [])) {
            interactionIds.add(interaction.id)
          }
        }
      }
      await Promise.all(Array.from(interactionIds, (interactionId) =>
        deleteEntityIfExists(request, adminToken, '/api/customers/interactions', interactionId),
      ))
      const messageCleanupFailures: Array<{ messageId: string; status: number | null }> = []
      for (const entry of [{ token: userBToken, message: reply }, { token: userAToken, message: original }]) {
        if (entry.token && entry.message) {
          const response = await apiRequest(request, 'DELETE', `/api/messages/${entry.message.messageId}`, { token: entry.token })
            .catch(() => null)
          if (!response || ![200, 404].includes(response.status())) {
            messageCleanupFailures.push({ messageId: entry.message.messageId, status: response?.status() ?? null })
          }
        }
      }
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
      await Promise.all([
        deleteChannelIfExists(request, userBToken, channelBId),
        deleteChannelIfExists(request, userAToken, channelAId),
      ])
      await Promise.all([
        deleteUserIfExists(request, adminToken, userBId),
        deleteUserIfExists(request, adminToken, userAId),
      ])
      await deleteRoleIfExists(request, adminToken, roleId)
      expect(messageCleanupFailures, 'each message author should be allowed to clean up their own message').toEqual([])
    }
  })
})
