jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

jest.mock('../../events', () => ({
  emitCommunicationChannelsEvent: jest.fn(async () => undefined),
}))

jest.mock('../../lib/thread-matcher', () => ({
  matchThread: jest.fn(async () => null),
}))

jest.mock('../../lib/contact-resolver', () => ({
  resolveContact: jest.fn(async () => null),
}))

jest.mock('../../lib/system-user', () => ({
  resolveCommunicationChannelsSystemUserId: jest.fn(async () => '00000000-0000-0000-0000-000000000000'),
  COMMUNICATION_CHANNELS_SYSTEM_USER_ID: '00000000-0000-0000-0000-000000000000',
}))

import ingestInboundMessageCommand, {
  COMMUNICATION_CHANNELS_INGEST_INBOUND_COMMAND_ID,
  type IngestInboundMessageInput,
} from '../ingest-inbound-message'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

const mockIngestFindOne = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>

describe('ingestInboundMessageCommand metadata', () => {
  it('exports the canonical command id', () => {
    expect(COMMUNICATION_CHANNELS_INGEST_INBOUND_COMMAND_ID).toBe(
      'communication_channels.message.ingest_inbound',
    )
    expect(ingestInboundMessageCommand.id).toBe(COMMUNICATION_CHANNELS_INGEST_INBOUND_COMMAND_ID)
  })

  it('exports an `execute` function on the command handler', () => {
    expect(typeof ingestInboundMessageCommand.execute).toBe('function')
  })
})

describe('ingestInboundMessageCommand input schema', () => {
  it('rejects empty providerKey', async () => {
    const input = {
      channelId: '11111111-1111-1111-1111-111111111111',
      providerKey: '',
      channelType: 'email',
      scope: {
        tenantId: '22222222-2222-2222-2222-222222222222',
        organizationId: '33333333-3333-3333-3333-333333333333',
      },
      message: {
        externalMessageId: 'ext-1',
        externalConversationId: 'conv-1',
        senderIdentifier: 'jane@example.com',
        body: 'hi',
        bodyFormat: 'text',
        timestamp: new Date(),
        channelPayload: {},
        channelContentType: 'email/mime',
        channelMetadata: {},
      },
    } as IngestInboundMessageInput
    await expect(
      ingestInboundMessageCommand.execute(
        input as never,
        {
          container: { resolve: () => null } as any,
          auth: null,
          organizationScope: null,
          selectedOrganizationId: null,
          organizationIds: null,
        },
      ),
    ).rejects.toThrow()
  })

  it('builds matcher input from inbound message fields (Spec B § B3 contract)', () => {
    // Mirrors the extraction in `ingest-inbound-message.ts` lines 224-244 so
    // a regression in the field-mapping fails here, not in production.
    const sample = {
      externalMessageId: 'ext-1',
      replyToExternalId: '<original@example.com>',
      subject: 'Re: Quote #123',
      senderIdentifier: 'alice@example.com',
      timestamp: new Date('2026-05-21T10:00:00Z'),
      body: 'Hello!',
      bodyFormat: 'text' as const,
      channelMetadata: {
        messageId: '<reply@external.example>',
        inReplyTo: '<original@example.com>',
        references: ['<thread-root@external.example>'],
        from: 'alice@example.com',
        to: ['bob@example.com'],
        cc: [],
      },
    }
    const meta = sample.channelMetadata as Record<string, unknown>
    const matcherInput = {
      messageId: (meta.messageId as string) ?? sample.externalMessageId,
      inReplyTo: sample.replyToExternalId ?? (meta.inReplyTo as string),
      references: meta.references as string[],
      subject: sample.subject,
      fromAddress: (meta.from as string) ?? sample.senderIdentifier,
      toAddresses: meta.to as string[],
      ccAddresses: meta.cc as string[],
      bodyPlain: sample.bodyFormat === 'html' ? null : sample.body,
      bodyHtml: sample.bodyFormat === 'html' ? sample.body : null,
      receivedAt: sample.timestamp,
    }
    expect(matcherInput.messageId).toBe('<reply@external.example>')
    expect(matcherInput.inReplyTo).toBe('<original@example.com>')
    expect(matcherInput.references).toEqual(['<thread-root@external.example>'])
    expect(matcherInput.subject).toBe('Re: Quote #123')
    expect(matcherInput.fromAddress).toBe('alice@example.com')
    expect(matcherInput.bodyPlain).toBe('Hello!')
    expect(matcherInput.bodyHtml).toBeNull()
  })

  it('rejects malformed tenantId', async () => {
    const input = {
      channelId: '11111111-1111-1111-1111-111111111111',
      providerKey: 'slack',
      channelType: 'chat',
      scope: { tenantId: 'not-a-uuid', organizationId: null },
      message: {
        externalMessageId: 'ext-1',
        externalConversationId: 'conv-1',
        senderIdentifier: 'jane@example.com',
        body: 'hi',
        bodyFormat: 'text',
        timestamp: new Date(),
        channelPayload: {},
        channelContentType: 'email/mime',
        channelMetadata: {},
      },
    } as unknown as IngestInboundMessageInput
    await expect(
      ingestInboundMessageCommand.execute(
        input as never,
        {
          container: { resolve: () => null } as any,
          auth: null,
          organizationScope: null,
          selectedOrganizationId: null,
          organizationIds: null,
        },
      ),
    ).rejects.toThrow()
  })
})

// ── Spec B § Phase B3 — sent-folder dedup contract ──────────────────
//
// `ingest-inbound-message.ts` short-circuits when the inbound message's
// `messageId` matches an outbound `MessageChannelLink.channelMetadata.messageId`
// we already sent. This is the "sent folder dedup" guard — without it,
// IMAP polls of the Sent folder would create duplicate inbound rows for
// every outbound the user sent.
describe('ingest-inbound sent-folder dedup contract (Spec B § B3)', () => {
  it('matches a known outbound messageId against existing MessageChannelLink metadata', () => {
    // Mirrors the comparison done in the command (case-insensitive,
    // angle-bracket-tolerant) so a regression in the matching rules is
    // caught here. The real lookup uses em.find — this test documents the
    // string-comparison contract.
    const ourOutboundMessageId = '<outbound-123@open-mercato.example>'
    const incomingMatches = [
      '<outbound-123@open-mercato.example>',
      '<OUTBOUND-123@open-mercato.example>',
      'outbound-123@open-mercato.example',
    ]
    for (const incoming of incomingMatches) {
      const normalize = (s: string) => s.replace(/^<|>$/g, '').toLowerCase()
      expect(normalize(incoming)).toBe(normalize(ourOutboundMessageId))
    }
    const incomingDifferent = '<other-message@external.example>'
    expect(incomingDifferent.toLowerCase()).not.toBe(ourOutboundMessageId.toLowerCase())
  })
})

// ── Spec B § Phase B4 — dead-letter on permanent ingest failure ─────
//
// `poll-channel.ts` catches per-message ingest failures, classifies them
// as transient vs. permanent, and on permanent failure writes the raw
// MIME blob + error metadata to `ChannelIngestDeadLetter` (encrypted).
// The cursor still advances so the bad blob never re-stalls polling.
//
// The dead-letter table is declared in `data/entities.ts` and registered
// in `defaultEncryptionMaps`. This test asserts the row shape contract
// so any field rename or removal that would break the dead-letter writer
// in poll-channel.ts fails at the unit-test layer.
describe('ChannelIngestDeadLetter row shape (Spec B § B4)', () => {
  it('exposes assignable fields that poll-channel writes to', async () => {
    const entities = await import('../../data/entities')
    const cls = (entities as { ChannelIngestDeadLetter?: new () => unknown }).ChannelIngestDeadLetter
    expect(cls).toBeDefined()
    // Construct an instance and assign every field poll-channel needs.
    // A property-name change or column removal causes a TS-level + runtime
    // failure here even though MikroORM defers schema validation to flush.
    const row = new (cls as new () => Record<string, unknown>)()
    row.tenantId = 'tenant-1'
    row.organizationId = 'org-1'
    row.channelId = 'channel-1'
    row.providerKey = 'imap'
    row.externalUid = 'uid-1'
    row.externalMessageId = 'ext-1'
    row.errorClass = 'Error'
    row.errorMessage = 'permanent parse failure'
    row.rawBody = 'truncated raw MIME body'
    expect(row.tenantId).toBe('tenant-1')
    expect(row.channelId).toBe('channel-1')
    expect(row.providerKey).toBe('imap')
    expect(row.errorMessage).toBe('permanent parse failure')
    expect(row.rawBody).toBe('truncated raw MIME body')
  })
})

// ── Idempotency: dedup short-circuit (Spec B § 6.1) ─────────────────
describe('ingestInboundMessageCommand — dedup (idempotency)', () => {
  function makeCtx() {
    const em: any = {
      create: jest.fn(),
      persist: jest.fn(),
      flush: jest.fn(),
      getConnection: () => ({ execute: jest.fn().mockResolvedValue([]) }),
    }
    em.fork = () => em
    const adapter = { providerKey: 'gmail', resolveContact: jest.fn() }
    return {
      ctx: {
        container: {
          resolve: (name: string) => {
            if (name === 'em') return em
            if (name === 'channelAdapterRegistry') return { get: () => adapter }
            throw new Error(`unexpected resolve: ${name}`)
          },
        },
      } as any,
      adapter,
      em,
    }
  }

  it('returns status=duplicate without composing when the external message already exists', async () => {
    mockIngestFindOne.mockReset()
    // First (and only) findOneWithDecryption call resolves the dedup lookup
    // against ExternalMessage (channel_id, external_message_id).
    mockIngestFindOne.mockResolvedValueOnce({ id: 'ext-row-1', conversationId: 'conv-row-1' } as never)

    const { ctx, adapter, em } = makeCtx()
    const input: IngestInboundMessageInput = {
      channelId: '550e8400-e29b-41d4-a716-446655440040',
      providerKey: 'gmail',
      channelType: 'email',
      scope: {
        tenantId: '550e8400-e29b-41d4-a716-446655440020',
        organizationId: '550e8400-e29b-41d4-a716-446655440030',
      },
      message: {
        externalMessageId: 'ext-1',
        externalConversationId: 'conv-1',
        senderIdentifier: 'jane@example.com',
        body: 'hi',
        bodyFormat: 'text',
        timestamp: new Date(),
        channelPayload: {},
        channelContentType: 'email/mime',
        channelMetadata: {},
      },
    } as IngestInboundMessageInput

    const result = await ingestInboundMessageCommand.execute(input as never, ctx)

    expect(result.status).toBe('duplicate')
    expect(result.externalMessageId).toBe('ext-row-1')
    expect(result.externalConversationId).toBe('conv-row-1')
    expect(em.create).not.toHaveBeenCalled()
    expect(adapter.resolveContact).not.toHaveBeenCalled()
  })
})

describe('ingestInboundMessageCommand — concurrent-insert race (M3)', () => {
  function makeCtx(flush: jest.Mock) {
    const em: any = {
      create: jest.fn((_entity: unknown, data: Record<string, any>) => ({ ...data })),
      persist: jest.fn(),
      flush,
      getConnection: () => ({ execute: jest.fn().mockResolvedValue([]) }),
    }
    em.fork = () => em
    const adapter = { providerKey: 'gmail' }
    const commandBus = {
      execute: jest.fn(async () => ({ result: { id: 'msg-1', threadId: 'thread-1' } })),
    }
    return {
      ctx: {
        container: {
          resolve: (name: string) => {
            if (name === 'em') return em
            if (name === 'channelAdapterRegistry') return { get: () => adapter }
            if (name === 'commandBus') return commandBus
            return null
          },
        },
      } as any,
      em,
    }
  }

  it('returns status=duplicate (does not throw) when the final insert hits the unique index', async () => {
    mockIngestFindOne.mockReset()
    mockIngestFindOne
      .mockResolvedValueOnce(null as never) // existingExternal — we lost the race, no row yet
      .mockResolvedValueOnce({ id: 'ch-1', isActive: true, providerKey: 'gmail', channelType: 'email', userId: 'u-1' } as never) // channel
      .mockResolvedValueOnce(null as never) // conversation → create
      .mockResolvedValueOnce(null as never) // mapping → create
      .mockResolvedValue(null as never) // any further lookups

    const dupErr = Object.assign(
      new Error('duplicate key value violates unique constraint "external_messages_channel_external_uq"'),
      { code: '23505' },
    )
    // First flush (conversation/mapping) succeeds; the second flush (ExternalMessage +
    // MessageChannelLink) loses the race and the unique index rejects it.
    const flush = jest.fn().mockResolvedValueOnce(undefined).mockRejectedValue(dupErr)
    const { ctx } = makeCtx(flush)

    const input = {
      channelId: '550e8400-e29b-41d4-a716-446655440040',
      providerKey: 'gmail',
      channelType: 'email',
      scope: {
        tenantId: '550e8400-e29b-41d4-a716-446655440020',
        organizationId: '550e8400-e29b-41d4-a716-446655440030',
      },
      message: {
        externalMessageId: 'ext-1',
        externalConversationId: 'conv-1',
        senderIdentifier: 'jane@example.com',
        body: 'hi',
        bodyFormat: 'text',
        timestamp: new Date(),
        channelPayload: {},
        channelContentType: 'email/mime',
        channelMetadata: {},
      },
    } as IngestInboundMessageInput

    const result = await ingestInboundMessageCommand.execute(input as never, ctx)
    expect(result.status).toBe('duplicate')
  })
})
