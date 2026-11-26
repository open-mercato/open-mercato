jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

jest.mock('../mutation-guards', () => ({
  ChannelMutationBlockedError: class ChannelMutationBlockedError extends Error {},
  guardOutboundCreate: jest.fn(async () => undefined),
}))

jest.mock('../queue', () => ({
  COMMUNICATION_CHANNELS_QUEUES: { outbound: 'communication_channels-outbound' },
  getCommunicationChannelsQueue: jest.fn(() => ({ enqueue: jest.fn(async () => undefined) })),
}))

const mockGetMessageAttachments = jest.fn(async (..._args: unknown[]): Promise<Array<{ id: string }>> => [])

jest.mock('../../../messages/lib/attachments', () => ({
  getMessageAttachments: (...args: unknown[]) => mockGetMessageAttachments(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: (_key: string, fallback: string) => fallback }),
}))

import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { MessageChannelLink } from '../../data/entities'
import { Message } from '../../../messages/data/entities'
import { baseEmailCapabilities } from '../email-capabilities'
import { OUTBOUND_ATTACHMENTS_METADATA_KEY } from '../outbound-attachments'
import { sendAsUser, type SendAsUserInput } from '../send-as-user'

const mockFindOne = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>
const mockFind = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>

const ATTACHMENT_ID = '550e8400-e29b-41d4-a716-446655440040'
const OWNER = { entityId: 'purchase_orders:purchase_order', recordId: 'po-1' }
const actor = { userId: 'u-1', tenantId: 'tenant-1', organizationId: 'org-1' }

function makeContainer(options: { fileSharing: boolean; scheduler?: boolean }) {
  const created: Array<{ entity: unknown; data: Record<string, unknown> }> = []
  const em: any = {
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
      const row = { id: `row-${created.length + 1}`, ...data }
      created.push({ entity, data: row })
      return row
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    nativeUpdate: jest.fn(async () => 1),
    transactional: jest.fn(async (work: (trx: unknown) => Promise<void>) => work(em)),
  }
  em.fork = () => em
  const commandBus = { execute: jest.fn(async () => ({ result: { id: 'msg-1', threadId: 'thread-1' } })) }
  const describeScoped = jest.fn(async () => ({
    id: ATTACHMENT_ID,
    fileName: 'order.pdf',
    mimeType: 'application/pdf',
    fileSize: 1000,
    partitionCode: 'privateAttachments',
  }))
  const adapter = { capabilities: { ...baseEmailCapabilities, fileSharing: options.fileSharing } }
  const container = {
    resolve: (name: string) => {
      if (name === 'em') return em
      if (name === 'commandBus') return commandBus
      if (name === 'channelAdapterRegistry') return { get: () => adapter }
      if (name === 'attachmentService') return { describeScoped }
      throw new Error(`unexpected resolve: ${name}`)
    },
    hasRegistration: (name: string) => options.scheduler === true && name === 'schedulerService',
  } as any
  return { container, commandBus, describeScoped, created }
}

function primeChannel() {
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

  it('gives every "send separately" copy the validated files', async () => {
    const { container, created } = makeContainer({ fileSharing: true })
    primeChannel()
    mockFind.mockReset()
    mockFind.mockResolvedValueOnce([
      { id: 'p-1', email: 'a@example.org' },
      { id: 'p-2', email: 'b@example.org' },
    ] as never)

    const result = await sendAsUser(container, actor, {
      ...baseInput,
      to: ['a@example.org', 'b@example.org'],
      sendSeparately: true,
      attachments: [{ kind: 'attachment', attachmentId: ATTACHMENT_ID, owner: OWNER, filename: 'Order 42.pdf' }],
    })

    expect(result).toMatchObject({ ok: true })
    const links = created.filter((row) => row.entity === MessageChannelLink)
    expect(links).toHaveLength(2)
    for (const link of links) {
      expect(link.data.channelMetadata).toMatchObject({
        [OUTBOUND_ATTACHMENTS_METADATA_KEY]: [{ attachmentId: ATTACHMENT_ID, owner: OWNER, filename: 'Order 42.pdf' }],
      })
    }
  })

  it('keeps the validated files of a scheduled send for its release', async () => {
    const { container, commandBus, created } = makeContainer({ fileSharing: true, scheduler: true })
    primeChannel()

    const result = await sendAsUser(container, actor, {
      ...baseInput,
      scheduledAt: new Date(Date.now() + 3_600_000),
      channelMetadata: { [OUTBOUND_ATTACHMENTS_METADATA_KEY]: [{ attachmentId: 'smuggled' }], crmVisibility: 'private' },
      attachments: [{ kind: 'attachment', attachmentId: ATTACHMENT_ID, owner: OWNER, filename: 'Order 42.pdf' }],
    })

    expect(result).toMatchObject({ ok: true })
    expect(created.some((row) => row.entity === MessageChannelLink)).toBe(false)
    const composeInput = (commandBus.execute.mock.calls[0] as unknown as [string, { input: Record<string, any> }])[1].input
    expect(composeInput.senderDeliveryOptions.channelMetadata).toEqual({
      crmVisibility: 'private',
      [OUTBOUND_ATTACHMENTS_METADATA_KEY]: [{ attachmentId: ATTACHMENT_ID, owner: OWNER, filename: 'Order 42.pdf' }],
    })
  })

  it('sends the files stored by a scheduled send when the message is released', async () => {
    const { container, created } = makeContainer({ fileSharing: true })
    const stored = [{ attachmentId: ATTACHMENT_ID, owner: OWNER, filename: 'Order 42.pdf' }]
    const message = {
      id: 'msg-1',
      threadId: 'msg-1',
      senderUserId: 'u-1',
      visibility: 'public',
      isDraft: false,
      subject: 'Order 42',
      body: 'Please find the order attached.',
      bodyFormat: 'text',
      emailSendSeparately: false,
      senderDeliveryOptions: { channelMetadata: { [OUTBOUND_ATTACHMENTS_METADATA_KEY]: stored }, references: [] },
    }
    mockFindOne.mockReset()
    mockFindOne
      .mockResolvedValueOnce(message as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({
        id: 'ch-1',
        userId: 'u-1',
        providerKey: 'gmail',
        channelType: 'email',
        isActive: true,
        status: 'connected',
      } as never)
      .mockImplementation(async (_em, entity) => (entity === Message ? message : null) as never)
    mockFind.mockReset()
    mockFind.mockResolvedValueOnce([{ id: 'p-1', role: 'to', email: 'buyer@example.org' }] as never)

    const result = await sendAsUser(container, actor, { userChannelId: 'ch-1', messageId: 'msg-1', channelMetadata: { crmVisibility: 'private' } })

    expect(result).toMatchObject({ ok: true })
    const link = created.find((row) => row.entity === MessageChannelLink)
    expect(link?.data.channelMetadata).toMatchObject({ crmVisibility: 'private', [OUTBOUND_ATTACHMENTS_METADATA_KEY]: stored })
  })

  describe('existing message', () => {
    const MESSAGE_ATTACHMENT_ID = '550e8400-e29b-41d4-a716-446655440041'
    const MESSAGE_OWNER = { entityId: 'messages:message', recordId: 'msg-1' }

    function primeExistingMessage(senderDeliveryOptions: Record<string, unknown> | null = null) {
      const message = {
        id: 'msg-1',
        threadId: 'msg-1',
        senderUserId: 'u-1',
        visibility: 'public',
        isDraft: false,
        subject: 'Order 42',
        body: 'Attached.',
        bodyFormat: 'text',
        emailSendSeparately: false,
        senderDeliveryOptions,
      }
      mockFindOne.mockReset()
      mockFindOne
        .mockResolvedValueOnce(message as never)
        .mockResolvedValueOnce(null as never)
        .mockResolvedValueOnce({ id: 'ch-1', userId: 'u-1', providerKey: 'gmail', channelType: 'email', isActive: true, status: 'connected' } as never)
        .mockImplementation(async (_em, entity) => (entity === Message ? message : null) as never)
      mockFind.mockReset()
      mockFind.mockResolvedValueOnce([{ id: 'p-1', role: 'to', email: 'buyer@example.org' }] as never)
    }

    afterEach(() => mockGetMessageAttachments.mockResolvedValue([]))

    it('sends the message\'s current attachments, owned by the message, at hand-off', async () => {
      const { container, created, describeScoped } = makeContainer({ fileSharing: true })
      primeExistingMessage()
      mockGetMessageAttachments.mockResolvedValue([{ id: MESSAGE_ATTACHMENT_ID }])

      const result = await sendAsUser(container, actor, { userChannelId: 'ch-1', messageId: 'msg-1' })

      expect(result).toMatchObject({ ok: true })
      expect(describeScoped).toHaveBeenCalledWith(expect.objectContaining({ attachmentId: MESSAGE_ATTACHMENT_ID, expectedOwner: MESSAGE_OWNER }))
      const link = created.find((row) => row.entity === MessageChannelLink)
      expect(link?.data.channelMetadata).toMatchObject({
        [OUTBOUND_ATTACHMENTS_METADATA_KEY]: [{ attachmentId: MESSAGE_ATTACHMENT_ID, owner: MESSAGE_OWNER }],
      })
    })

    it('skips a stored scheduled-send file that was deleted before the release', async () => {
      const { container, created, describeScoped } = makeContainer({ fileSharing: true })
      primeExistingMessage({ channelMetadata: { [OUTBOUND_ATTACHMENTS_METADATA_KEY]: [{ attachmentId: ATTACHMENT_ID, owner: OWNER }] } })
      describeScoped.mockRejectedValueOnce(new CrudHttpError(404, { error: 'Not found' }))

      const result = await sendAsUser(container, actor, { userChannelId: 'ch-1', messageId: 'msg-1' })

      expect(result).toMatchObject({ ok: true })
      const link = created.find((row) => row.entity === MessageChannelLink)
      expect(link?.data.channelMetadata ?? {}).not.toHaveProperty(OUTBOUND_ATTACHMENTS_METADATA_KEY)
    })

    it('refuses the hand-off when the mailbox cannot send the message\'s attachments', async () => {
      const { container, created } = makeContainer({ fileSharing: false })
      primeExistingMessage()
      mockGetMessageAttachments.mockResolvedValue([{ id: MESSAGE_ATTACHMENT_ID }])

      const result = await sendAsUser(container, actor, { userChannelId: 'ch-1', messageId: 'msg-1' })

      expect(result).toMatchObject({ ok: false, status: 422, code: 'attachments_unsupported' })
      expect(created.find((row) => row.entity === MessageChannelLink)).toBeUndefined()
    })
  })
})
