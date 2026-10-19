import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

jest.mock('../../events', () => ({
  emitCommunicationChannelsEvent: jest.fn(async () => undefined),
}))

jest.mock('../../lib/credential-refresh', () => ({
  refreshCredentialsIfNeeded: jest.fn(async (input: { credentials: Record<string, unknown> }) => ({
    refreshed: false,
    credentials: input.credentials,
  })),
}))

jest.mock('../../lib/thread-token', () => ({
  getOrCreateThreadToken: jest.fn(async () => ({ token: 'tok-1' })),
  buildBodyFooter: jest.fn(() => ({ html: '', plain: '' })),
  buildReferencesId: jest.fn((token: string) => `<om-${token}>`),
}))

import deliverOutboundMessageCommand from '../deliver-outbound-message'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { baseEmailCapabilities } from '../../lib/email-capabilities'
import { OUTBOUND_ATTACHMENTS_METADATA_KEY } from '../../lib/outbound-attachments'

const mockFindOne = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>

const MSG = '550e8400-e29b-41d4-a716-446655440010'
const TENANT = '550e8400-e29b-41d4-a716-446655440020'
const ORG = '550e8400-e29b-41d4-a716-446655440030'
const ATTACHMENT_ID = '550e8400-e29b-41d4-a716-446655440040'
const OWNER = { entityId: 'purchase_orders:purchase_order', recordId: 'po-1' }

function makeCtx(options: { fileSharing?: boolean; readScoped?: jest.Mock }) {
  const em: any = {
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
  }
  em.fork = () => em
  const adapter = {
    providerKey: 'gmail',
    capabilities: { ...baseEmailCapabilities, fileSharing: options.fileSharing ?? true },
    convertOutbound: jest.fn(async () => ({ content: { text: 'hello' }, metadata: {} })),
    sendMessage: jest.fn(async () => ({ status: 'sent', externalMessageId: 'ext-1' })),
  }
  const readScoped =
    options.readScoped ??
    jest.fn(async () => ({
      buffer: Buffer.from('%PDF-1.7 order'),
      contentType: 'application/octet-stream',
      contentDisposition: 'attachment',
      fileName: 'order.pdf',
      mimeType: 'application/pdf',
    }))
  const ctx = {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'channelAdapterRegistry') return { get: () => adapter }
        if (name === 'integrationCredentialsService') return { resolve: async () => ({}) }
        if (name === 'integrationLogService') return { error: jest.fn() }
        if (name === 'attachmentService') return { readScoped }
        throw new Error(`unexpected resolve: ${name}`)
      },
    },
  } as any
  return { ctx, adapter, readScoped }
}

function primeFinds(link: Record<string, unknown>, channelUserId: string | null = 'u-1') {
  mockFindOne.mockReset()
  mockFindOne
    .mockResolvedValueOnce({ id: 'msg-1', threadId: 'thread-1', body: 'hello', bodyFormat: 'text' } as never)
    .mockResolvedValueOnce({
      messageThreadId: 'thread-1',
      channelId: 'ch-1',
      externalConversationId: 'conv-1',
      externalThreadRef: 'outbound:thread-1',
    } as never)
    .mockResolvedValueOnce({
      id: 'ch-1',
      isActive: true,
      providerKey: 'gmail',
      channelType: 'email',
      userId: channelUserId,
      credentialsRef: null,
      status: 'connected',
    } as never)
    .mockResolvedValueOnce(link as never)
}

function pendingLink(): Record<string, unknown> {
  return {
    id: 'link-1',
    deliveryStatus: 'pending',
    channelPayload: { text: 'hello' },
    channelMetadata: {
      to: ['buyer@example.org'],
      [OUTBOUND_ATTACHMENTS_METADATA_KEY]: [{ attachmentId: ATTACHMENT_ID, owner: OWNER, filename: 'Order 42.pdf' }],
    },
  }
}

describe('deliverOutboundMessageCommand — outbound attachments', () => {
  it('reads the stored attachments as the channel owner and hands the bytes to convertOutbound', async () => {
    const link = pendingLink()
    const { ctx, adapter, readScoped } = makeCtx({})
    primeFinds(link)

    const result = await deliverOutboundMessageCommand.execute(
      { messageId: MSG, scope: { tenantId: TENANT, organizationId: ORG } } as never,
      ctx,
    )

    expect((result as { status: string }).status).toBe('delivered')
    expect(readScoped).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: ATTACHMENT_ID,
        expectedOwner: OWNER,
        auth: expect.objectContaining({ sub: 'u-1', tenantId: TENANT, orgId: ORG }),
      }),
    )
    const convertInput = adapter.convertOutbound.mock.calls[0][0] as unknown as {
      attachments: Array<{ fileName: string; mimeType: string; content: Uint8Array }>
      channelMetadata: Record<string, unknown>
    }
    expect(convertInput.attachments).toHaveLength(1)
    expect(convertInput.attachments[0]).toMatchObject({ fileName: 'Order 42.pdf', mimeType: 'application/pdf' })
    expect(Buffer.from(convertInput.attachments[0].content).toString()).toBe('%PDF-1.7 order')
    expect(convertInput.channelMetadata).not.toHaveProperty(OUTBOUND_ATTACHMENTS_METADATA_KEY)
  })

  it('fails the delivery permanently, without sending, when an attachment is no longer readable', async () => {
    const link = pendingLink()
    const readScoped = jest.fn(async () => {
      throw new CrudHttpError(404, { error: 'Attachment not found' })
    })
    const { ctx, adapter } = makeCtx({ readScoped })
    primeFinds(link)

    const result = await deliverOutboundMessageCommand.execute(
      { messageId: MSG, scope: { tenantId: TENANT, organizationId: ORG } } as never,
      ctx,
    )

    expect(result).toMatchObject({ status: 'failed', transient: false })
    expect(adapter.sendMessage).not.toHaveBeenCalled()
    expect(link.deliveryStatus).toBe('failed')
  })

  it('keeps a database failure while reading an attachment transient so the worker retries', async () => {
    const link = pendingLink()
    const readScoped = jest.fn(async () => {
      throw Object.assign(new Error('could not serialize access due to concurrent update'), { code: '40001' })
    })
    const { ctx, adapter } = makeCtx({ readScoped })
    primeFinds(link)

    const result = await deliverOutboundMessageCommand.execute(
      { messageId: MSG, scope: { tenantId: TENANT, organizationId: ORG } } as never,
      ctx,
    )

    expect(result).toMatchObject({ status: 'failed', transient: true })
    expect(adapter.sendMessage).not.toHaveBeenCalled()
  })

  it('fails permanently when the adapter stopped sharing files after the message was queued', async () => {
    const link = pendingLink()
    const { ctx, adapter, readScoped } = makeCtx({ fileSharing: false })
    primeFinds(link)

    const result = await deliverOutboundMessageCommand.execute(
      { messageId: MSG, scope: { tenantId: TENANT, organizationId: ORG } } as never,
      ctx,
    )

    expect(result).toMatchObject({ status: 'failed', transient: false })
    expect(readScoped).not.toHaveBeenCalled()
    expect(adapter.sendMessage).not.toHaveBeenCalled()
  })

  it('passes no attachments when the link carries none', async () => {
    const link = { id: 'link-1', deliveryStatus: 'pending', channelPayload: { text: 'hello' }, channelMetadata: { to: ['a@example.org'] } }
    const { ctx, adapter, readScoped } = makeCtx({})
    primeFinds(link)

    await deliverOutboundMessageCommand.execute(
      { messageId: MSG, scope: { tenantId: TENANT, organizationId: ORG } } as never,
      ctx,
    )

    expect(readScoped).not.toHaveBeenCalled()
    expect(adapter.convertOutbound.mock.calls[0][0]).not.toHaveProperty('attachments')
  })
})
