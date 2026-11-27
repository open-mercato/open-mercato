import { createHash, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { MailboxComposeTransaction } from '@open-mercato/shared/modules/messages/compose-payload'
import type { sendAsUser } from '../lib/send-as-user'
import { resolveAppRoot } from '@open-mercato/core/helpers/integration/appRoot'
import { importFromAppRuntime } from '@open-mercato/core/helpers/integration/appRuntime'
import { withNextRuntime } from '@open-mercato/core/helpers/integration/nextRuntime'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  getAuthToken,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { deleteAttachmentIfExists, uploadAttachmentFixture } from '@open-mercato/core/helpers/integration/attachmentsFixtures'
import { createPersonFixture, deleteEntityIfExists, loadCustomerMessageObjectTypes } from '@open-mercato/core/helpers/integration/crmFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  deleteChannelIfExists,
  inspectMessageChannelLinks,
  isChannelSeedingAvailable,
  listCapturedSystemEmails,
  seedConnectedChannel,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import { deleteMessageIfExists } from '@open-mercato/core/modules/messages/__integration__/helpers'

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
  test('a chosen mailbox sends the file, keeps the linked record, and writes a thread mapping', async ({ request }) => {
    const stamp = randomUUID()
    let token: string | null = null
    let channelId: string | null = null
    let personId: string | null = null
    let attachmentId: string | null = null
    let messageId: string | null = null

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
      personId = await createPersonFixture(request, token, {
        firstName: 'Mailbox',
        lastName: 'Recipient',
        displayName: `Mailbox recipient ${stamp}`,
      })
      const recordId = `messages-composer:${stamp}`
      const subject = `Composer mailbox send ${stamp}`
      const buffer = Buffer.from(`%PDF-1.4\n% compose payload ${stamp}\n`)
      const file = await uploadAttachmentFixture(request, token, {
        entityId: 'attachments:library',
        recordId,
        fileName: 'quote.pdf',
        mimeType: 'application/pdf',
        buffer,
      })
      attachmentId = file.id

      const payload = {
        type: 'default',
        visibility: 'public',
        externalEmail: `client-${stamp}@example.com`,
        subject,
        body: 'Sent from the employee mailbox.',
        bodyFormat: 'text',
        senderChannelId: channelId,
        attachmentRecordId: recordId,
        attachmentIds: [attachmentId],
        objects: [{ entityModule: 'customers', entityType: 'person', entityId: personId }],
      }
      const wrongOwner = await apiRequest(request, 'POST', '/api/messages', {
        token,
        data: { ...payload, attachmentRecordId: `messages-composer:${randomUUID()}` },
      })
      expect(wrongOwner.status()).toBe(422)
      expect(await readJsonSafe(wrongOwner)).toMatchObject({
        fieldErrors: { senderChannelId: expect.any(String) },
      })

      const response = await apiRequest(request, 'POST', '/api/messages', { token, data: payload })
      expect(
        response.status(),
        'composing with a selected mailbox should be accepted',
      ).toBe(201)

      const created = await readJsonSafe<{ id?: string; threadId?: string }>(response)
      expect(created?.id, 'compose response should carry the message id').toBeTruthy()
      messageId = created!.id!

      const detail = await apiRequest(request, 'GET', `/api/messages/${messageId}`, { token })
      expect(detail.status()).toBe(200)
      expect(await readJsonSafe(detail)).toMatchObject({
        objects: [expect.objectContaining({ entityModule: 'customers', entityType: 'person', entityId: personId })],
      })

      const attachmentQuery = new URLSearchParams({ entityId: 'messages:message', recordId: messageId })
      const attachments = await apiRequest(request, 'GET', `/api/attachments?${attachmentQuery}`, { token })
      expect(attachments.status()).toBe(200)
      expect(await readJsonSafe(attachments)).toMatchObject({
        items: [expect.objectContaining({ id: attachmentId, fileName: file.fileName })],
      })

      const inspected = await inspectMessageChannelLinks(request, token, messageId)
      const outbound = inspected.links.filter((link) => link.direction === 'outbound')
      expect(outbound.length, 'an outbound MessageChannelLink should exist').toBe(1)
      expect(outbound[0].externalConversationId).toBeTruthy()

      const mapping = inspected.threadMappings.find(
        (entry) => entry.externalConversationId === outbound[0].externalConversationId,
      )
      expect(mapping, 'a ChannelThreadMapping should exist for the thread').toBeTruthy()
      expect(mapping!.channelId).toBe(channelId)
      expect(mapping!.messageThreadId).toBeTruthy()

      const captureToken = token
      await expect.poll(async () => {
        await drainIntegrationQueue('communication-channels-outbound')
        const captured = await listCapturedSystemEmails(request, captureToken)
        return captured.filter((item) => item.metadata?.subject === subject).map(
          (item) => item.content.attachmentDigests,
        )
      }).toEqual([[{
        version: 1,
        fileName: file.fileName,
        mimeType: 'application/pdf',
        fileSize: buffer.byteLength,
        sha256: createHash('sha256').update(buffer).digest('hex'),
      }]])
    } finally {
      await deleteAttachmentIfExists(request, token, attachmentId)
      await deleteMessageIfExists(request, token, messageId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      await deleteChannelIfExists(request, token, channelId)
    }
  })

  test('rolls back an unsuccessful link write and preserves a subsequently accepted delivery', async ({ request }) => withNextRuntime(async () => {
    test.slow()
    const token = await getAuthToken(request)
    test.skip(!await isChannelSeedingAvailable(request, token), 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')
    const stamp = randomUUID()
    const recordId = `messages-composer:${stamp}`
    const scope = getTokenScope(token)
    const auth = { sub: scope.userId, orgId: scope.organizationId, tenantId: scope.tenantId }
    const [{ bootstrapFromAppRoot }, { createRequestContainer }, hubQueue, objectRegistry, customerObjectTypes] = await Promise.all([
      importFromAppRuntime<typeof import('@open-mercato/shared/lib/bootstrap/dynamicLoader')>('@open-mercato/shared/lib/bootstrap/dynamicLoader'),
      importFromAppRuntime<typeof import('@open-mercato/shared/lib/di/container')>('@open-mercato/shared/lib/di/container'),
      importFromAppRuntime<typeof import('@open-mercato/core/modules/communication_channels/lib/queue')>('@open-mercato/core/modules/communication_channels/lib/queue'),
      importFromAppRuntime<typeof import('@open-mercato/core/modules/messages/lib/message-objects-registry')>('@open-mercato/core/modules/messages/lib/message-objects-registry'),
      loadCustomerMessageObjectTypes(),
    ])
    await bootstrapFromAppRoot(resolveAppRoot())
    const previousObjectTypes = objectRegistry.getAllMessageObjectTypes()
    const container = await createRequestContainer()
    const queue = hubQueue.getCommunicationChannelsQueue(hubQueue.COMMUNICATION_CHANNELS_QUEUES.outbound)
    const originalEnqueue = queue.enqueue
    const accepted: string[] = []
    let channelId: string | null = null
    let personId: string | null = null
    let attachmentId: string | null = null
    let messageId: string | null = null

    try {
      objectRegistry.registerMessageObjectTypes(customerObjectTypes)
      channelId = await seedConnectedChannel(request, token, { displayName: `Recovery ${stamp}` })
      personId = await createPersonFixture(request, token, { firstName: 'Mailbox', lastName: stamp, displayName: `Recovery ${stamp}` })
      const upload = await uploadAttachmentFixture(request, token, {
        entityId: 'attachments:library', recordId, fileName: 'quote.pdf',
        mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n'),
      })
      attachmentId = upload.id
      const objects = [{ entityModule: 'customers', entityType: 'person', entityId: personId }]
      const uploads = { attachmentIds: [attachmentId], recordId }
      queue.enqueue = async (job) => {
        if (typeof job.messageId !== 'string') throw new Error('[internal] Expected a delivery message ID')
        accepted.push(job.messageId)
        await withClient(async (client) => {
          const updated = await client.query(
            "update message_channel_links set delivery_status = 'sent' where message_id = $1 and tenant_id = $2 and organization_id = $3 and direction = 'outbound'",
            [job.messageId, scope.tenantId, scope.organizationId],
          )
          expect(updated.rowCount).toBe(1)
        })
        throw new Error('[internal] Lost acknowledgement after accepting delivery')
      }

      let rolledBackId: string | undefined
      const ctx: CommandRuntimeContext & MailboxComposeTransaction = {
        container, auth, selectedOrganizationId: scope.organizationId, organizationIds: [scope.organizationId], organizationScope: null,
        persistMailboxDelivery: async (_em, message) => {
          rolledBackId = message.messageId
          throw new Error('[internal] Injected outbound link write failure')
        },
      }
      const bus = container.resolve<CommandBus>('commandBus')
      await expect(bus.execute('messages.messages.compose', {
        ctx, input: {
          ...scope, type: 'channel.test_seed', visibility: 'public', externalEmail: 'client@example.com',
          subject: stamp, body: 'Recovery test', sendViaEmail: false, objects,
          mailboxComposeMessageType: 'default', mailboxComposeUpload: uploads,
        },
      })).rejects.toThrow('Injected outbound link write failure')
      expect(rolledBackId).toBeTruthy()
      await withClient(async (client) => {
        expect((await client.query('select id from messages where id = $1', [rolledBackId])).rows).toEqual([])
        expect((await client.query('select id from message_objects where message_id = $1', [rolledBackId])).rows).toEqual([])
        expect((await client.query('select entity_id, record_id from attachments where id = $1', [attachmentId])).rows)
          .toEqual([{ entity_id: 'attachments:library', record_id: recordId }])
      })
      expect(accepted).toEqual([])

      const send = container.resolve<typeof sendAsUser>('communicationChannelsSendAsUser')
      const result = await send(container, { ...scope, auth }, {
        userChannelId: channelId, to: ['client@example.com'], subject: stamp, body: { plain: 'Recovery test' },
        composerPayload: { messageType: 'default', uploads, objects },
      })
      expect(result).toMatchObject({ ok: true, deliveryEnqueueStatus: 'unconfirmed', threadId: expect.any(String) })
      if (!result.ok) throw new Error('[internal] Expected a committed message')
      messageId = result.messageId
      expect(accepted).toEqual([messageId])
      const detail = await apiRequest(request, 'GET', `/api/messages/${messageId}`, { token })
      expect(detail.status()).toBe(200)
      expect(await readJsonSafe(detail)).toMatchObject({ objects: [expect.objectContaining(objects[0])] })
      const attachmentQuery = new URLSearchParams({ entityId: 'messages:message', recordId: messageId })
      const attachments = await apiRequest(request, 'GET', `/api/attachments?${attachmentQuery}`, { token })
      expect(attachments.status()).toBe(200)
      expect(await readJsonSafe(attachments)).toMatchObject({ items: [expect.objectContaining({ id: upload.id })] })
      await withClient(async (client) => {
        expect((await client.query(
          'select delivery_status from message_channel_links where message_id = $1 and tenant_id = $2 and organization_id = $3',
          [messageId, scope.tenantId, scope.organizationId],
        )).rows).toEqual([{ delivery_status: 'sent' }])
      })
    } finally {
      queue.enqueue = originalEnqueue
      objectRegistry.registerMessageObjectTypes(previousObjectTypes, { replace: true })
      await deleteAttachmentIfExists(request, token, attachmentId)
      await deleteMessageIfExists(request, token, messageId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      await deleteChannelIfExists(request, token, channelId)
      await container.dispose()
    }
  }))

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

  test('a mailbox nobody has connected is refused as not found', async ({ request }) => {
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
        senderChannelId: '00000000-0000-4000-8000-0000000000ff',
      },
    })

    expect(response.status(), 'a nonexistent channel id is a 404, not a silent success').toBe(404)
    const body = await readJsonSafe<{ fieldErrors?: Record<string, string> }>(response)
    expect(
      body?.fieldErrors?.senderChannelId,
      'the failure should land on the composer sender field',
    ).toBeTruthy()
  })

  test('a mailbox connected by a different employee is refused, not silently ignored', async ({ request }) => {
    const stamp = Date.now()
    let adminToken: string | null = null
    let ownerToken: string | null = null
    let ownerUserId: string | null = null
    let roleId: string | null = null
    let channelId: string | null = null

    try {
      adminToken = await getAuthToken(request)
      const seedingAvailable = await isChannelSeedingAvailable(request, adminToken)
      test.skip(!seedingAvailable, 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')

      const scope = getTokenScope(adminToken)

      const roleName = `qa_channel_hub_004_owner_${stamp}`
      roleId = await createRoleFixture(request, adminToken, {
        name: roleName,
        tenantId: scope.tenantId,
      })
      const aclResp = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
        token: adminToken,
        data: {
          roleId,
          features: ['communication_channels.connect_user_channel'],
        },
      })
      expect(aclResp.ok(), 'PUT /api/auth/roles/acl (channel owner) should succeed').toBeTruthy()

      const ownerEmail = `qa-channel-hub-004-owner-${stamp}@example.com`
      const ownerPassword = 'Valid1!Pass'
      ownerUserId = await createUserFixture(request, adminToken, {
        email: ownerEmail,
        password: ownerPassword,
        organizationId: scope.organizationId,
        roles: [roleName],
        name: 'QA Channel Hub 004 Owner',
      })
      ownerToken = await getAuthToken(request, ownerEmail, ownerPassword)

      channelId = await seedConnectedChannel(request, ownerToken, {
        displayName: `Someone else's mailbox ${stamp}`,
        externalIdentifier: `channel-owner-${stamp}@example.com`,
      })

      const response = await apiRequest(request, 'POST', '/api/messages', {
        token: adminToken,
        data: {
          type: 'default',
          visibility: 'public',
          externalEmail: `client-${stamp}@example.com`,
          subject: `Borrowed mailbox ${stamp}`,
          body: 'Should not be sent.',
          bodyFormat: 'text',
          senderChannelId: channelId,
        },
      })

      expect(response.status(), 'sending through a channel owned by someone else is a 403').toBe(403)
      const body = await readJsonSafe<{ fieldErrors?: Record<string, string> }>(response)
      expect(
        body?.fieldErrors?.senderChannelId,
        'the failure should land on the composer sender field',
      ).toBeTruthy()
    } finally {
      await deleteChannelIfExists(request, ownerToken, channelId)
      await deleteUserIfExists(request, adminToken, ownerUserId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
