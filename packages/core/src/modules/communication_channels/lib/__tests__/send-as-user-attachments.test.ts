jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

jest.mock('../mutation-guards', () => ({
  ChannelMutationBlockedError: class ChannelMutationBlockedError extends Error {},
  guardOutboundCreate: jest.fn(async () => undefined),
}))

jest.mock('../queue', () => ({
  COMMUNICATION_CHANNELS_QUEUES: { outbound: 'communication_channels-outbound' },
  getCommunicationChannelsQueue: jest.fn(() => ({ enqueue: mockEnqueue })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: (_key: string, fallback: string) => fallback }),
}))

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { MailboxComposeTransaction } from '@open-mercato/shared/modules/messages/compose-payload'
import { MessageChannelLink } from '../../data/entities'
import { baseEmailCapabilities } from '../email-capabilities'
import { OUTBOUND_ATTACHMENTS_METADATA_KEY } from '../outbound-attachments'
import { sendAsUser, type SendAsUserInput } from '../send-as-user'

const mockFindOne = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>
const mockEnqueue = jest.fn(async () => undefined)

const ATTACHMENT_ID = '550e8400-e29b-41d4-a716-446655440040'
const OWNER = { entityId: 'purchase_orders:purchase_order', recordId: 'po-1' }
const actor = { userId: 'u-1', tenantId: 'tenant-1', organizationId: 'org-1' }

function makeContainer(options: { fileSharing: boolean; maxAttachmentCount?: number }) {
  const created: Array<{ entity: unknown; data: Record<string, unknown> }> = []
  const em = {
    fork: () => em,
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
      const row = { id: `row-${created.length + 1}`, ...data }
      created.push({ entity, data: row })
      return row
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
    transactional: jest.fn(async (work: () => Promise<void>) => work()),
  }
  const commandBus = {
    execute: jest.fn(async (_commandId: string, { ctx }: { ctx: MailboxComposeTransaction }) => {
      if (ctx.persistMailboxDelivery) {
        await em.begin()
        try {
          await ctx.persistMailboxDelivery(
            em as unknown as Parameters<NonNullable<MailboxComposeTransaction['persistMailboxDelivery']>>[0],
            { messageId: 'msg-1', threadId: 'thread-1' },
          )
          await em.commit()
        } catch (error) {
          await em.rollback()
          throw error
        }
      }
      return { result: { id: 'msg-1', threadId: 'thread-1' } }
    }),
  }
  const describeScoped = jest.fn(async () => ({
    id: ATTACHMENT_ID,
    fileName: 'order.pdf',
    mimeType: 'application/pdf',
    fileSize: 1000,
    partitionCode: 'privateAttachments',
  }))
  const adapter = { capabilities: { ...baseEmailCapabilities, ...options } }
  const container = {
    resolve: (name: string) => {
      if (name === 'em') return em
      if (name === 'commandBus') return commandBus
      if (name === 'channelAdapterRegistry') return { get: () => adapter }
      if (name === 'attachmentService') return { describeScoped }
      throw new Error(`unexpected resolve: ${name}`)
    },
  } as unknown as Parameters<typeof sendAsUser>[0]
  return { container, commandBus, describeScoped, created, em }
}

function primeChannel() {
  mockEnqueue.mockClear()
  mockFindOne.mockReset()
  mockFindOne.mockResolvedValueOnce({
    id: 'ch-1',
    userId: 'u-1',
    providerKey: 'gmail',
    channelType: 'email',
    isActive: true,
    status: 'connected',
  } as never)
  mockFindOne.mockResolvedValue(null as never)
}

const baseInput: SendAsUserInput = {
  userChannelId: 'ch-1',
  to: ['buyer@example.org'],
  subject: 'Order 42',
  body: { plain: 'Please find the order attached.' },
}

describe('sendAsUser — attachments', () => {
  const recordId = 'messages-composer:the-session'
  const objects = [{
    entityModule: 'customers',
    entityType: 'person',
    entityId: '44444444-4444-4444-8444-444444444444',
  }]
  const composerPayload = {
    messageType: 'default',
    objects,
    uploads: { recordId, attachmentIds: [ATTACHMENT_ID] },
  }

  it('uses the temporary owner for preflight and the committed message owner for delivery', async () => {
    const { container, commandBus, describeScoped, created, em } = makeContainer({ fileSharing: true })
    primeChannel()

    const result = await sendAsUser(container, actor, { ...baseInput, composerPayload })

    expect(result).toMatchObject({ ok: true, messageId: 'msg-1' })
    expect(describeScoped).toHaveBeenCalledWith(expect.objectContaining({
      attachmentId: ATTACHMENT_ID,
      expectedOwner: { entityId: 'attachments:library', recordId },
    }))
    expect(commandBus.execute).toHaveBeenCalledWith('messages.messages.compose', {
      input: expect.objectContaining({
        objects,
        mailboxComposeMessageType: 'default',
        mailboxComposeUpload: composerPayload.uploads,
        sendViaEmail: false,
      }),
      ctx: expect.objectContaining({ persistMailboxDelivery: expect.any(Function) }),
    })
    const link = created.find((row) => row.entity === MessageChannelLink)
    expect(link?.data.channelMetadata).toMatchObject({
      [OUTBOUND_ATTACHMENTS_METADATA_KEY]: [{
        attachmentId: ATTACHMENT_ID,
        owner: { entityId: 'messages:message', recordId: 'msg-1' },
      }],
    })
    expect(link?.data.channelMetadata).not.toHaveProperty('objects')
    expect(em.commit.mock.invocationCallOrder[0]).toBeLessThan(mockEnqueue.mock.invocationCallOrder[0])
  })

  it('refuses an unavailable compose upload before writing or queuing', async () => {
    const { container, commandBus, describeScoped } = makeContainer({ fileSharing: true })
    primeChannel()
    describeScoped.mockRejectedValueOnce(new CrudHttpError(404, { error: 'Attachment not found' }))

    const result = await sendAsUser(container, actor, { ...baseInput, composerPayload })

    expect(result).toMatchObject({ ok: false, status: 422, code: 'attachment_not_found' })
    expect(commandBus.execute).not.toHaveBeenCalled()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('rolls back the composer transaction if the outbound link write fails', async () => {
    const { container, em } = makeContainer({ fileSharing: true })
    primeChannel()
    em.flush.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('[internal] link write failed'))

    const result = await sendAsUser(container, actor, { ...baseInput, composerPayload })

    expect(result).toMatchObject({ ok: false, status: 500 })
    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(em.commit).not.toHaveBeenCalled()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('honors an adapter count limit before reading compose uploads', async () => {
    const secondAttachment = '550e8400-e29b-41d4-a716-446655440041'
    const { container, describeScoped, commandBus } = makeContainer({ fileSharing: true, maxAttachmentCount: 1 })
    primeChannel()

    const result = await sendAsUser(container, actor, {
      ...baseInput,
      composerPayload: {
        uploads: { recordId, attachmentIds: [ATTACHMENT_ID, secondAttachment] },
      },
    })

    expect(result).toMatchObject({ ok: false, status: 422, code: 'too_many_attachments' })
    expect(describeScoped).not.toHaveBeenCalled()
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('refuses attachments on an adapter without file sharing before composing anything', async () => {
    const { container, commandBus, describeScoped } = makeContainer({ fileSharing: false })
    primeChannel()

    const result = await sendAsUser(container, actor, {
      ...baseInput,
      attachments: [{ kind: 'attachment', attachmentId: ATTACHMENT_ID, owner: OWNER }],
    })

    expect(result).toMatchObject({ ok: false, status: 422, code: 'attachments_unsupported' })
    expect(commandBus.execute).not.toHaveBeenCalled()
    expect(describeScoped).not.toHaveBeenCalled()
  })

  it('refuses a display name that breaks the upload rules when passed in-process', async () => {
    const { container, commandBus, describeScoped } = makeContainer({ fileSharing: true })
    primeChannel()

    const result = await sendAsUser(container, actor, {
      ...baseInput,
      attachments: [{ kind: 'attachment', attachmentId: ATTACHMENT_ID, owner: OWNER, filename: 'a\r\nBcc: x.pdf' }],
    })

    expect(result).toMatchObject({ ok: false, status: 422, code: 'attachment_type_not_allowed' })
    expect(describeScoped).not.toHaveBeenCalled()
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('refuses malformed refs passed in-process before reading anything', async () => {
    const { container, commandBus, describeScoped } = makeContainer({ fileSharing: true })
    primeChannel()

    const result = await sendAsUser(container, actor, {
      ...baseInput,
      attachments: [{ kind: 'attachment', attachmentId: 'not-a-uuid', owner: OWNER, filename: 'a\r\nBcc: x' }],
    })

    expect(result).toMatchObject({ ok: false, status: 422 })
    expect(describeScoped).not.toHaveBeenCalled()
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('stores only the validated refs under the hub key and drops a caller-supplied value', async () => {
    const { container, describeScoped, created } = makeContainer({ fileSharing: true })
    primeChannel()

    const result = await sendAsUser(container, actor, {
      ...baseInput,
      channelMetadata: {
        crmVisibility: 'private',
        [OUTBOUND_ATTACHMENTS_METADATA_KEY]: [{ attachmentId: 'smuggled', owner: { entityId: 'x', recordId: 'y' } }],
      },
      attachments: [{ kind: 'attachment', attachmentId: ATTACHMENT_ID, owner: OWNER, filename: 'Order 42.pdf' }],
    })

    expect(result).toMatchObject({ ok: true, messageId: 'msg-1' })
    expect(describeScoped).toHaveBeenCalledWith(expect.objectContaining({ attachmentId: ATTACHMENT_ID, expectedOwner: OWNER }))
    const link = created.find((row) => row.entity === MessageChannelLink)
    expect(link?.data.channelMetadata).toMatchObject({
      crmVisibility: 'private',
      [OUTBOUND_ATTACHMENTS_METADATA_KEY]: [{ attachmentId: ATTACHMENT_ID, owner: OWNER, filename: 'Order 42.pdf' }],
    })
  })

  it('drops a caller-supplied refs key when the message has no attachments', async () => {
    const { container, created } = makeContainer({ fileSharing: true })
    primeChannel()

    await sendAsUser(container, actor, {
      ...baseInput,
      channelMetadata: { [OUTBOUND_ATTACHMENTS_METADATA_KEY]: [{ attachmentId: ATTACHMENT_ID, owner: OWNER }] },
    })

    const link = created.find((row) => row.entity === MessageChannelLink)
    expect(link?.data.channelMetadata).not.toHaveProperty(OUTBOUND_ATTACHMENTS_METADATA_KEY)
  })
})
