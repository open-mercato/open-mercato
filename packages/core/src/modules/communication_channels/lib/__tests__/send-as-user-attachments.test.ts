jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

jest.mock('../mutation-guards', () => ({
  ChannelMutationBlockedError: class ChannelMutationBlockedError extends Error {},
  guardOutboundCreate: jest.fn(async () => undefined),
}))

jest.mock('../queue', () => ({
  COMMUNICATION_CHANNELS_QUEUES: { outbound: 'communication_channels-outbound' },
  getCommunicationChannelsQueue: jest.fn(() => ({ enqueue: jest.fn(async () => undefined) })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: (_key: string, fallback: string) => fallback }),
}))

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { MessageChannelLink } from '../../data/entities'
import { baseEmailCapabilities } from '../email-capabilities'
import { OUTBOUND_ATTACHMENTS_METADATA_KEY } from '../outbound-attachments'
import { sendAsUser, type SendAsUserInput } from '../send-as-user'

const mockFindOne = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>

const ATTACHMENT_ID = '550e8400-e29b-41d4-a716-446655440040'
const OWNER = { entityId: 'purchase_orders:purchase_order', recordId: 'po-1' }
const actor = { userId: 'u-1', tenantId: 'tenant-1', organizationId: 'org-1' }

function makeContainer(options: { fileSharing: boolean }) {
  const created: Array<{ entity: unknown; data: Record<string, unknown> }> = []
  const em: any = {
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
      const row = { id: `row-${created.length + 1}`, ...data }
      created.push({ entity, data: row })
      return row
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    transactional: jest.fn(async (work: () => Promise<void>) => work()),
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
