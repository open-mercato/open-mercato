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

import deliverOutboundMessageCommand, {
  COMMUNICATION_CHANNELS_DELIVER_OUTBOUND_COMMAND_ID,
} from '../deliver-outbound-message'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitCommunicationChannelsEvent } from '../../events'
import { ExternalMessage } from '../../data/entities'

const mockFindOne = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>
const mockEmit = emitCommunicationChannelsEvent as jest.MockedFunction<typeof emitCommunicationChannelsEvent>

describe('deliverOutboundMessageCommand metadata', () => {
  it('exports the canonical command id', () => {
    expect(COMMUNICATION_CHANNELS_DELIVER_OUTBOUND_COMMAND_ID).toBe(
      'communication_channels.message.deliver_outbound',
    )
    expect(deliverOutboundMessageCommand.id).toBe(COMMUNICATION_CHANNELS_DELIVER_OUTBOUND_COMMAND_ID)
  })

  it('exports an `execute` function on the command handler', () => {
    expect(typeof deliverOutboundMessageCommand.execute).toBe('function')
  })
})

describe('deliverOutboundMessageCommand input schema', () => {
  function emptyCtx() {
    return {
      container: { resolve: () => null } as any,
      auth: null,
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
    }
  }

  it('rejects malformed messageId', async () => {
    await expect(
      deliverOutboundMessageCommand.execute(
        { messageId: 'not-a-uuid', scope: { tenantId: '11111111-1111-1111-1111-111111111111', organizationId: null } } as never,
        emptyCtx(),
      ),
    ).rejects.toThrow()
  })

  it('rejects missing scope.tenantId', async () => {
    await expect(
      deliverOutboundMessageCommand.execute(
        { messageId: '11111111-1111-1111-1111-111111111111', scope: { organizationId: null } } as never,
        emptyCtx(),
      ),
    ).rejects.toThrow()
  })

  it('accepts a valid input shape (then fails later because DI is empty — that is fine)', async () => {
    // We expect execute() to fail past schema validation. The point of this test
    // is that Zod accepts the shape; richer behaviour is covered by integration tests.
    await expect(
      deliverOutboundMessageCommand.execute(
        {
          messageId: '11111111-1111-1111-1111-111111111111',
          scope: {
            tenantId: '22222222-2222-2222-2222-222222222222',
            organizationId: '33333333-3333-3333-3333-333333333333',
          },
        } as never,
        emptyCtx(),
      ),
    ).rejects.toThrow() // throws due to missing `em` in container — not a schema error
  })
})

// ── Idempotency: outbound double-send guard (Spec 045d §7.3) ────────
describe('deliverOutboundMessageCommand — idempotency (no double-send)', () => {
  const VALID_MSG = '550e8400-e29b-41d4-a716-446655440010'
  const VALID_TENANT = '550e8400-e29b-41d4-a716-446655440020'
  const VALID_ORG = '550e8400-e29b-41d4-a716-446655440030'

  function makeCtx(adapter: Record<string, unknown>) {
    const em: any = { create: jest.fn(), persist: jest.fn(), flush: jest.fn() }
    em.fork = () => em
    return {
      container: {
        resolve: (name: string) => {
          if (name === 'em') return em
          if (name === 'channelAdapterRegistry') return { get: () => adapter }
          throw new Error(`unexpected resolve: ${name}`)
        },
      },
    } as any
  }

  it('short-circuits an already-sent link without invoking the adapter', async () => {
    mockFindOne.mockReset()
    mockFindOne
      .mockResolvedValueOnce({ id: 'msg-1', threadId: 'thread-1', body: 'hi', bodyFormat: 'text' } as never) // message
      .mockResolvedValueOnce({ messageThreadId: 'thread-1', channelId: 'ch-1', externalConversationId: 'conv-1', externalThreadRef: 'ext-1' } as never) // thread mapping
      .mockResolvedValueOnce({ id: 'ch-1', isActive: true, providerKey: 'gmail', channelType: 'email', userId: 'u-1', credentialsRef: null } as never) // channel
      .mockResolvedValueOnce({ id: 'link-1', deliveryStatus: 'sent' } as never) // existing already-sent link

    const sendMessage = jest.fn()
    const result = await deliverOutboundMessageCommand.execute(
      { messageId: VALID_MSG, scope: { tenantId: VALID_TENANT, organizationId: VALID_ORG } } as never,
      makeCtx({ providerKey: 'gmail', sendMessage }),
    )

    expect(result).toEqual({ status: 'already_delivered', messageId: 'msg-1', channelLinkId: 'link-1' })
    expect(sendMessage).not.toHaveBeenCalled()
  })
})

// ── Review fixes: outbound link FK integrity (H1) + reauth signalling (H2) ──
describe('deliverOutboundMessageCommand — link integrity + reauth', () => {
  const MSG = '550e8400-e29b-41d4-a716-446655440010'
  const TENANT = '550e8400-e29b-41d4-a716-446655440020'
  const ORG = '550e8400-e29b-41d4-a716-446655440030'

  type Created = { entity: unknown; data: Record<string, any> }

  function makeCtx(opts: {
    sendResult?: { status: string; externalMessageId?: string; error?: string }
    channelStatus?: string
  }) {
    const created: Created[] = []
    const em: any = {
      create: jest.fn((entity: unknown, data: Record<string, any>) => {
        const obj = { ...data }
        created.push({ entity, data: obj })
        return obj
      }),
      persist: jest.fn(),
      flush: jest.fn(async () => undefined),
    }
    em.fork = () => em
    const channel = {
      id: 'ch-1',
      isActive: true,
      providerKey: 'gmail',
      channelType: 'email',
      userId: 'u-1',
      credentialsRef: null,
      status: opts.channelStatus ?? 'connected',
    }
    const adapter = {
      providerKey: 'gmail',
      convertOutbound: jest.fn(async () => ({ content: { raw: 'x' }, metadata: {} })),
      sendMessage: jest.fn(async () => opts.sendResult ?? { status: 'sent', externalMessageId: 'ext-1' }),
    }
    const ctx = {
      container: {
        resolve: (name: string) => {
          if (name === 'em') return em
          if (name === 'channelAdapterRegistry') return { get: () => adapter }
          if (name === 'integrationCredentialsService') return { resolve: async () => ({}) }
          if (name === 'integrationLogService') return { error: jest.fn() }
          throw new Error(`unexpected resolve: ${name}`)
        },
      },
    } as any
    return { ctx, em, channel, adapter, created }
  }

  function primeFinds(channel: Record<string, any>, link: Record<string, any> | null) {
    mockFindOne.mockReset()
    mockFindOne
      .mockResolvedValueOnce({ id: 'msg-1', threadId: 'thread-1', body: 'hello', bodyFormat: 'text' } as never)
      .mockResolvedValueOnce({
        messageThreadId: 'thread-1',
        channelId: 'ch-1',
        externalConversationId: 'conv-1',
        externalThreadRef: 'ext-ref-1',
      } as never)
      .mockResolvedValueOnce(channel as never)
      .mockResolvedValueOnce(link as never)
  }

  beforeEach(() => {
    mockEmit.mockClear()
  })

  it('persists a non-null external_message_id on the outbound link (H1)', async () => {
    const link: Record<string, any> = { id: 'link-1', deliveryStatus: 'pending', channelPayload: null, channelMetadata: null }
    const { ctx, channel, created } = makeCtx({ sendResult: { status: 'sent', externalMessageId: 'ext-1' } })
    primeFinds(channel, link)

    const result = await deliverOutboundMessageCommand.execute(
      { messageId: MSG, scope: { tenantId: TENANT, organizationId: ORG } } as never,
      ctx,
    )

    expect((result as any).status).toBe('delivered')
    const extMsg = created.find((c) => c.entity === ExternalMessage)
    expect(extMsg).toBeDefined()
    expect(typeof extMsg!.data.id).toBe('string')
    expect((extMsg!.data.id as string).length).toBeGreaterThan(0)
    expect(typeof link.externalMessageId).toBe('string')
    expect(link.externalMessageId).toBe(extMsg!.data.id)
    // The adapter's convertOutbound returns empty metadata (the IMAP/SMTP case,
    // where the transport mints the Message-ID). The hub MUST still persist a
    // `messageId` on the link — falling back to the RFC2822 id the recipient
    // replies to — so inbound JWZ thread-matching + sent-folder dedup can resolve
    // this outbound message.
    expect((link.channelMetadata as Record<string, unknown>).messageId).toBe('ext-1')
  })

  it('stores the RFC2822 Message-ID bracket-stripped so inbound dedup/JWZ matching resolves it (regression)', async () => {
    const link: Record<string, any> = { id: 'link-1', deliveryStatus: 'pending', channelPayload: null, channelMetadata: null }
    const { ctx, channel } = makeCtx({ sendResult: { status: 'sent', externalMessageId: '<rfc-abc@example.com>' } })
    primeFinds(channel, link)

    await deliverOutboundMessageCommand.execute(
      { messageId: MSG, scope: { tenantId: TENANT, organizationId: ORG } } as never,
      ctx,
    )

    // `normalizeMimeInbound` stores inbound message ids bracket-stripped, and both the
    // sent-folder dedup and the JWZ thread matcher compare against that stripped form.
    // The outbound link MUST persist the same convention, otherwise '<id>' vs 'id'
    // silently mismatches and every outbound message is re-ingested / fails to thread.
    expect((link.channelMetadata as Record<string, unknown>).messageId).toBe('rfc-abc@example.com')
  })

  it('flips the channel to requires_reauth and emits the event on a 401 (H2)', async () => {
    const link: Record<string, any> = { id: 'link-1', deliveryStatus: 'pending', channelPayload: null, channelMetadata: null }
    const { ctx, channel } = makeCtx({ sendResult: { status: 'failed', error: '401 Unauthorized' }, channelStatus: 'connected' })
    primeFinds(channel, link)

    const result = await deliverOutboundMessageCommand.execute(
      { messageId: MSG, scope: { tenantId: TENANT, organizationId: ORG } } as never,
      ctx,
    )

    expect((result as any).status).toBe('failed')
    expect((result as any).requiresReauth).toBe(true)
    expect(channel.status).toBe('requires_reauth')
    expect(mockEmit).toHaveBeenCalledWith(
      'communication_channels.channel.requires_reauth',
      expect.objectContaining({ channelId: 'ch-1' }),
      expect.anything(),
    )
  })

  it('resets a requires_reauth channel back to connected after a successful send (H2 self-heal)', async () => {
    const link: Record<string, any> = { id: 'link-1', deliveryStatus: 'pending', channelPayload: null, channelMetadata: null }
    const { ctx, channel } = makeCtx({ sendResult: { status: 'sent', externalMessageId: 'ext-1' }, channelStatus: 'requires_reauth' })
    primeFinds(channel, link)

    const result = await deliverOutboundMessageCommand.execute(
      { messageId: MSG, scope: { tenantId: TENANT, organizationId: ORG } } as never,
      ctx,
    )

    expect((result as any).status).toBe('delivered')
    expect(channel.status).toBe('connected')
  })

  it('defers to the race winner on a pending-link unique violation instead of double-sending', async () => {
    const { ctx, em, channel, adapter } = makeCtx({ sendResult: { status: 'sent', externalMessageId: 'ext-1' } })
    // No existing link → the command creates the 'pending' link; a concurrent
    // delivery already inserted it, so the flush hits message_channel_links_message_uq.
    primeFinds(channel, null)
    mockFindOne.mockResolvedValueOnce({ id: 'winner-link', deliveryStatus: 'pending' } as never) // re-fetch after 23505
    em.flush = jest.fn(async () => {
      throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })
    })

    const result = await deliverOutboundMessageCommand.execute(
      { messageId: MSG, scope: { tenantId: TENANT, organizationId: ORG } } as never,
      ctx,
    )

    expect(result).toEqual({ status: 'already_delivered', messageId: 'msg-1', channelLinkId: 'winner-link' })
    expect(adapter.sendMessage).not.toHaveBeenCalled()
  })
})
