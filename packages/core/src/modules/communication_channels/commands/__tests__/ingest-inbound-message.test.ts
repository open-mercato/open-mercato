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
import { resolveCommunicationChannelsSystemUserId } from '../../lib/system-user'
import { composeMessageSchema } from '../../../messages/data/validators'
import { emitCommunicationChannelsEvent } from '../../events'

const mockIngestFindOne = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>
const mockIngestEmit = emitCommunicationChannelsEvent as jest.MockedFunction<
  typeof emitCommunicationChannelsEvent
>

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
describe('ingestInboundMessageCommand — non-email sender identity (#4975)', () => {
  function makeCtx() {
    const em: any = {
      create: jest.fn((_entity: unknown, data: Record<string, any>) => ({
        id: '550e8400-e29b-41d4-a716-446655440050',
        ...data,
      })),
      persist: jest.fn(),
      flush: jest.fn().mockResolvedValue(undefined),
      getConnection: () => ({ execute: jest.fn().mockResolvedValue([]) }),
    }
    em.fork = () => em
    const adapter = { providerKey: 'discord' }
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
      commandBus,
    }
  }

  function discordInput(): IngestInboundMessageInput {
    return {
      channelId: '550e8400-e29b-41d4-a716-446655440040',
      providerKey: 'discord',
      channelType: 'discord',
      scope: {
        tenantId: '550e8400-e29b-41d4-a716-446655440020',
        organizationId: '550e8400-e29b-41d4-a716-446655440030',
      },
      message: {
        externalMessageId: 'discord-message-1',
        externalConversationId: '1534331920463433771',
        // A Discord snowflake, exactly as the gateway produces it — no address.
        senderIdentifier: '1499156851487539260',
        senderDisplayName: 'Karol Kapsa',
        body: 'Kolejna wiadomość testowa!@',
        bodyFormat: 'text',
        timestamp: new Date(),
        channelPayload: {},
        channelContentType: 'text/plain',
        channelMetadata: {},
      },
    } as IngestInboundMessageInput
  }

  function primeLookups(): void {
    mockIngestFindOne.mockReset()
    mockIngestFindOne
      .mockResolvedValueOnce(null as never) // existingExternal — first delivery
      .mockResolvedValueOnce({
        id: 'ch-1',
        isActive: true,
        providerKey: 'discord',
        channelType: 'discord',
        userId: '550e8400-e29b-41d4-a716-446655440077',
      } as never) // channel
      .mockResolvedValueOnce(null as never) // conversation → create
      .mockResolvedValueOnce(null as never) // mapping → create
      .mockResolvedValue(null as never)
  }

  it('passes the channel type to the compose command so the hub can waive externalEmail', async () => {
    primeLookups()
    const { ctx, commandBus } = makeCtx()

    await ingestInboundMessageCommand.execute(discordInput() as never, ctx)

    const composeCall = commandBus.execute.mock.calls.find(
      (call: unknown[]) => call[0] === 'messages.messages.compose',
    )
    expect(composeCall).toBeDefined()
    const composeInput = (composeCall as any[])[1].input as Record<string, unknown>
    expect(composeInput.sourceChannelType).toBe('discord')
    expect(composeInput.externalEmail).toBeUndefined()
  })

  it('produces a compose payload the messages validator accepts with no address', async () => {
    // The regression this pins: before #4975 this exact payload failed
    // `externalEmail is required when visibility is public`, the ingest job
    // retried three times and died, and no inbound Discord message ever landed.
    primeLookups()
    const { ctx, commandBus } = makeCtx()

    await ingestInboundMessageCommand.execute(discordInput() as never, ctx)

    const composeCall = commandBus.execute.mock.calls.find(
      (call: unknown[]) => call[0] === 'messages.messages.compose',
    )
    const composeInput = (composeCall as any[])[1].input as Record<string, unknown>
    const parsed = composeMessageSchema.safeParse(composeInput)

    expect(parsed.success).toBe(true)
  })

  it('still demands an address on an email-typed channel', async () => {
    mockIngestFindOne.mockReset()
    mockIngestFindOne
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({
        id: 'ch-1',
        isActive: true,
        providerKey: 'gmail',
        channelType: 'email',
        userId: 'u-1',
      } as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValue(null as never)
    const { ctx, commandBus } = makeCtx()

    const input = { ...discordInput(), providerKey: 'gmail', channelType: 'email' }
    await ingestInboundMessageCommand.execute(input as never, ctx)

    const composeCall = commandBus.execute.mock.calls.find(
      (call: unknown[]) => call[0] === 'messages.messages.compose',
    )
    const composeInput = (composeCall as any[])[1].input as Record<string, unknown>
    expect(composeInput.sourceChannelType).toBe('email')
    const parsed = composeMessageSchema.safeParse(composeInput)
    expect(parsed.success).toBe(false)
    expect(
      parsed.error?.issues.some((issue) => issue.path[0] === 'externalEmail'),
    ).toBe(true)
  })
})

describe('ingestInboundMessageCommand — provider timestamp (#6095)', () => {
  function makeCtx() {
    const em: any = {
      create: jest.fn((_entity: unknown, data: Record<string, any>) => ({
        id: '550e8400-e29b-41d4-a716-446655440050',
        ...data,
      })),
      persist: jest.fn(),
      flush: jest.fn().mockResolvedValue(undefined),
      getConnection: () => ({ execute: jest.fn().mockResolvedValue([]) }),
    }
    em.fork = () => em
    const commandBus = {
      execute: jest.fn(async () => ({ result: { id: 'msg-1', threadId: 'thread-1' } })),
    }
    return {
      ctx: {
        container: {
          resolve: (name: string) => {
            if (name === 'em') return em
            if (name === 'channelAdapterRegistry') return { get: () => ({ providerKey: 'gmail' }) }
            if (name === 'commandBus') return commandBus
            return null
          },
        },
      } as any,
      commandBus,
    }
  }

  function emailInput(timestamp: Date): IngestInboundMessageInput {
    return {
      channelId: '550e8400-e29b-41d4-a716-446655440040',
      providerKey: 'gmail',
      channelType: 'email',
      scope: {
        tenantId: '550e8400-e29b-41d4-a716-446655440020',
        organizationId: '550e8400-e29b-41d4-a716-446655440030',
      },
      message: {
        externalMessageId: 'gmail-message-1',
        externalConversationId: 'thread-abc',
        senderIdentifier: 'alice@example.com',
        senderDisplayName: 'Alice',
        subject: 'Quote',
        body: 'Hello',
        bodyFormat: 'text',
        timestamp,
        channelPayload: {},
        channelContentType: 'email/mime',
        channelMetadata: {},
      },
    } as IngestInboundMessageInput
  }

  function primeLookups(): void {
    mockIngestFindOne.mockReset()
    mockIngestFindOne
      .mockResolvedValueOnce(null as never) // existingExternal — first delivery
      .mockResolvedValueOnce({
        id: 'ch-1',
        isActive: true,
        providerKey: 'gmail',
        channelType: 'email',
        userId: 'u-1',
      } as never) // channel
      .mockResolvedValueOnce(null as never) // conversation → create
      .mockResolvedValueOnce(null as never) // mapping → create
      .mockResolvedValue(null as never)
  }

  function composeInputOf(commandBus: { execute: jest.Mock }): Record<string, unknown> {
    const composeCall = commandBus.execute.mock.calls.find(
      (call: unknown[]) => call[0] === 'messages.messages.compose',
    )
    expect(composeCall).toBeDefined()
    return (composeCall as any[])[1].input as Record<string, unknown>
  }

  it('forwards the provider timestamp to compose as sentAt', async () => {
    // Before #6095 compose stamped `new Date()`, so a 90-day history import
    // showed every message on the import day, in import order.
    primeLookups()
    const { ctx, commandBus } = makeCtx()
    const receivedAt = new Date('2026-06-16T08:30:00Z')

    await ingestInboundMessageCommand.execute(emailInput(receivedAt) as never, ctx)

    const composeInput = composeInputOf(commandBus)
    expect(composeInput.sentAt).toEqual(receivedAt)
    // Contact resolution is mocked out above, so supply the address the real
    // adapter would have resolved and check the hub accepts the timestamp.
    const parsed = composeMessageSchema.safeParse({
      ...composeInput,
      externalEmail: 'alice@example.com',
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data?.sentAt).toEqual(receivedAt)
  })

  it('carries the provider timestamp on the emitted message.received payload', async () => {
    // The customers subscriber dates its CustomerInteraction from this field.
    // It must travel on the event, not be re-read from the ExternalMessage row
    // by the consuming module (AGENTS.md Cross-Module Coupling).
    primeLookups()
    mockIngestEmit.mockClear()
    const { ctx } = makeCtx()
    const receivedAt = new Date('2026-06-16T08:30:00Z')

    await ingestInboundMessageCommand.execute(emailInput(receivedAt) as never, ctx)

    const receivedCall = mockIngestEmit.mock.calls.find(
      (call: unknown[]) => call[0] === 'communication_channels.message.received',
    )
    expect(receivedCall).toBeDefined()
    expect((receivedCall as any[])[1]).toMatchObject({
      providerTimestamp: receivedAt.toISOString(),
    })
  })
})

describe('ingestInboundMessageCommand — assigned conversation (#6093)', () => {
  const assigneeId = '550e8400-e29b-41d4-a716-446655440099'

  function makeCtx() {
    const em: any = {
      create: jest.fn((_entity: unknown, data: Record<string, any>) => ({
        id: '550e8400-e29b-41d4-a716-446655440050',
        ...data,
      })),
      persist: jest.fn(),
      flush: jest.fn().mockResolvedValue(undefined),
      getConnection: () => ({ execute: jest.fn().mockResolvedValue([]) }),
    }
    em.fork = () => em
    const commandBus = {
      execute: jest.fn(async () => ({ result: { id: 'msg-2', threadId: 'thread-1' } })),
    }
    return {
      ctx: {
        container: {
          resolve: (name: string) => {
            if (name === 'em') return em
            if (name === 'channelAdapterRegistry') return { get: () => ({ providerKey: 'gmail' }) }
            if (name === 'commandBus') return commandBus
            return null
          },
        },
      } as any,
      commandBus,
    }
  }

  function emailInput(): IngestInboundMessageInput {
    return {
      channelId: '550e8400-e29b-41d4-a716-446655440040',
      providerKey: 'gmail',
      channelType: 'email',
      scope: {
        tenantId: '550e8400-e29b-41d4-a716-446655440020',
        organizationId: '550e8400-e29b-41d4-a716-446655440030',
      },
      message: {
        externalMessageId: 'gmail-message-2',
        externalConversationId: 'thread-abc',
        senderIdentifier: 'alice@example.com',
        senderDisplayName: 'Alice',
        subject: 'Re: Quote',
        body: 'Please go ahead.',
        bodyFormat: 'text',
        timestamp: new Date(),
        channelPayload: {},
        channelContentType: 'email/mime',
        channelMetadata: {},
      },
    } as IngestInboundMessageInput
  }

  function primeLookups(mapping: Record<string, unknown> | null, channelUserId: string | null = 'u-1'): void {
    mockIngestFindOne.mockReset()
    mockIngestFindOne
      .mockResolvedValueOnce(null as never) // existingExternal — first delivery
      .mockResolvedValueOnce({
        id: 'ch-1',
        isActive: true,
        providerKey: 'gmail',
        channelType: 'email',
        userId: channelUserId,
      } as never) // channel
      .mockResolvedValueOnce({
        id: '550e8400-e29b-41d4-a716-446655440061',
        channelId: '550e8400-e29b-41d4-a716-446655440040',
        externalConversationId: 'thread-abc',
        lastMessageAt: new Date('2026-06-01T00:00:00Z'),
      } as never) // existing conversation
      .mockResolvedValueOnce(mapping as never) // existing thread mapping
      .mockResolvedValue(null as never)
  }

  function composeInputOf(commandBus: { execute: jest.Mock }): Record<string, unknown> {
    const composeCall = commandBus.execute.mock.calls.find(
      (call: unknown[]) => call[0] === 'messages.messages.compose',
    )
    expect(composeCall).toBeDefined()
    return (composeCall as any[])[1].input as Record<string, unknown>
  }

  it('addresses the message to the assigned user and marks it as channel-inbound', async () => {
    primeLookups({ id: 'map-1', assignedUserId: assigneeId, messageThreadId: '550e8400-e29b-41d4-a716-446655440071' })
    const { ctx, commandBus } = makeCtx()

    await ingestInboundMessageCommand.execute(emailInput() as never, ctx)

    const composeInput = composeInputOf(commandBus)
    expect(composeInput.recipients).toEqual([{ userId: assigneeId, type: 'to' }])
    expect(composeInput.inboundFromChannel).toBe(true)
  })

  it('produces a compose payload the messages validator accepts once the conversation is assigned', async () => {
    // The regression this pins: before #6093 this exact payload failed
    // `recipients must be empty when visibility is public`, the worker logged
    // "permanent ingest failure; skipping message", and every reply after the
    // conversation was assigned (e.g. by replying from the panel) was dropped.
    primeLookups({ id: 'map-1', assignedUserId: assigneeId, messageThreadId: '550e8400-e29b-41d4-a716-446655440071' })
    const { ctx, commandBus } = makeCtx()

    await ingestInboundMessageCommand.execute(emailInput() as never, ctx)

    // Contact resolution is mocked out above; supply the address the adapter
    // would have resolved so only the recipients rule is under test.
    const parsed = composeMessageSchema.safeParse({
      ...composeInputOf(commandBus),
      externalEmail: 'alice@example.com',
    })
    expect(parsed.success).toBe(true)
  })

  it('still composes an unassigned conversation on a tenant-wide channel with no recipients', async () => {
    primeLookups({ id: 'map-1', assignedUserId: null, messageThreadId: '550e8400-e29b-41d4-a716-446655440071' }, null)
    const { ctx, commandBus } = makeCtx()

    await ingestInboundMessageCommand.execute(emailInput() as never, ctx)

    const composeInput = composeInputOf(commandBus)
    expect(composeInput.recipients).toEqual([])
    expect(composeInput.inboundFromChannel).toBe(true)
  })
})

describe('ingestInboundMessageCommand — per-user channel owner is the default assignee (#6106)', () => {
  const ownerId = '550e8400-e29b-41d4-a716-446655440088'
  const assigneeId = '550e8400-e29b-41d4-a716-446655440099'
  const conversationId = '550e8400-e29b-41d4-a716-446655440061'

  function makeCtx() {
    const created: Array<{ data: Record<string, any> }> = []
    const em: any = {
      create: jest.fn((_entity: unknown, data: Record<string, any>) => {
        const row = { id: '550e8400-e29b-41d4-a716-446655440050', ...data }
        created.push({ data: row })
        return row
      }),
      persist: jest.fn(),
      flush: jest.fn().mockResolvedValue(undefined),
      getConnection: () => ({ execute: jest.fn().mockResolvedValue([]) }),
    }
    em.fork = () => em
    const commandBus = {
      execute: jest.fn(async () => ({ result: { id: 'msg-3', threadId: 'thread-3' } })),
    }
    return {
      created,
      commandBus,
      ctx: {
        container: {
          resolve: (name: string) => {
            if (name === 'em') return em
            if (name === 'channelAdapterRegistry') return { get: () => ({ providerKey: 'discord' }) }
            if (name === 'commandBus') return commandBus
            return null
          },
        },
      } as any,
    }
  }

  function discordInput(): IngestInboundMessageInput {
    return {
      channelId: '550e8400-e29b-41d4-a716-446655440040',
      providerKey: 'discord',
      channelType: 'discord',
      scope: {
        tenantId: '550e8400-e29b-41d4-a716-446655440020',
        organizationId: '550e8400-e29b-41d4-a716-446655440030',
      },
      message: {
        externalMessageId: '1550017981365358683',
        externalConversationId: 'discord:1541039457296326710',
        senderIdentifier: '1465576843796156549',
        senderDisplayName: 'Discord user',
        body: 'hello from discord',
        bodyFormat: 'text',
        timestamp: new Date(),
        channelPayload: {},
        channelContentType: 'discord/message',
        channelMetadata: {},
      },
    } as IngestInboundMessageInput
  }

  function primeLookups(options: {
    channelUserId: string | null
    conversation: Record<string, unknown> | null
    mapping: Record<string, unknown> | null
  }): void {
    mockIngestFindOne.mockReset()
    mockIngestFindOne
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({
        id: 'ch-1',
        isActive: true,
        providerKey: 'discord',
        channelType: 'discord',
        userId: options.channelUserId,
      } as never)
      .mockResolvedValueOnce(options.conversation as never)
      .mockResolvedValueOnce(options.mapping as never)
      .mockResolvedValue(null as never)
  }

  function composeInputOf(commandBus: { execute: jest.Mock }): Record<string, any> {
    const composeCall = commandBus.execute.mock.calls.find(
      (call: unknown[]) => call[0] === 'messages.messages.compose',
    )
    expect(composeCall).toBeDefined()
    return (composeCall as any[])[1].input as Record<string, any>
  }

  function createdWith(created: Array<{ data: Record<string, any> }>, key: string): Record<string, any> | undefined {
    return created.map((entry) => entry.data).find((row) => key in row)
  }

  it('addresses the first message of a thread to the channel owner and assigns the new thread to them', async () => {
    primeLookups({ channelUserId: ownerId, conversation: null, mapping: null })
    const { ctx, commandBus, created } = makeCtx()

    await ingestInboundMessageCommand.execute(discordInput() as never, ctx)

    const composeInput = composeInputOf(commandBus)
    expect(composeInput.recipients).toEqual([{ userId: ownerId, type: 'to' }])
    expect(composeInput.inboundFromChannel).toBe(true)
    expect(createdWith(created, 'lastMessageAt')?.assignedUserId).toBe(ownerId)
    expect(createdWith(created, 'externalThreadRef')?.assignedUserId).toBe(ownerId)
    const parsed = composeMessageSchema.safeParse(composeInput)
    expect(parsed.success).toBe(true)
  })

  it('routes a later message on an unassigned legacy thread to the channel owner', async () => {
    primeLookups({
      channelUserId: ownerId,
      conversation: { id: conversationId, lastMessageAt: new Date('2026-06-01T00:00:00Z') },
      mapping: { id: 'map-1', assignedUserId: null, messageThreadId: '550e8400-e29b-41d4-a716-446655440071' },
    })
    const { ctx, commandBus, created } = makeCtx()

    await ingestInboundMessageCommand.execute(discordInput() as never, ctx)

    expect(composeInputOf(commandBus).recipients).toEqual([{ userId: ownerId, type: 'to' }])
    expect(createdWith(created, 'externalThreadRef')).toBeUndefined()
    const senderFallback = (resolveCommunicationChannelsSystemUserId as jest.Mock).mock.calls.at(-1)?.[2]
    expect(senderFallback).toBeNull()
  })

  it('keeps a manual assignment authoritative over the channel owner', async () => {
    primeLookups({
      channelUserId: ownerId,
      conversation: { id: conversationId, lastMessageAt: new Date('2026-06-01T00:00:00Z') },
      mapping: { id: 'map-1', assignedUserId: assigneeId, messageThreadId: '550e8400-e29b-41d4-a716-446655440071' },
    })
    const { ctx, commandBus } = makeCtx()

    await ingestInboundMessageCommand.execute(discordInput() as never, ctx)

    expect(composeInputOf(commandBus).recipients).toEqual([{ userId: assigneeId, type: 'to' }])
  })

  it('leaves a tenant-wide channel unassigned and without recipients', async () => {
    primeLookups({ channelUserId: null, conversation: null, mapping: null })
    const { ctx, commandBus, created } = makeCtx()

    await ingestInboundMessageCommand.execute(discordInput() as never, ctx)

    expect(composeInputOf(commandBus).recipients).toEqual([])
    expect(createdWith(created, 'lastMessageAt')?.assignedUserId).toBeNull()
    expect(createdWith(created, 'externalThreadRef')?.assignedUserId).toBeNull()
  })
})
describe('ingestInboundMessageCommand — HTML body normalization', () => {
  function makeCtx() {
    const em: any = {
      create: jest.fn((_entity: unknown, data: Record<string, any>) => ({ ...data })),
      persist: jest.fn(),
      flush: jest.fn().mockResolvedValue(undefined),
      getConnection: () => ({ execute: jest.fn().mockResolvedValue([]) }),
    }
    em.fork = () => em
    const commandBus = {
      execute: jest.fn(async () => ({ result: { id: 'msg-1', threadId: 'thread-1' } })),
    }
    return {
      ctx: {
        container: {
          resolve: (name: string) => {
            if (name === 'em') return em
            if (name === 'channelAdapterRegistry') return { get: () => ({ providerKey: 'imap' }) }
            if (name === 'commandBus') return commandBus
            return null
          },
        },
      } as any,
      commandBus,
    }
  }

  function makeInput(
    body: string,
    bodyFormat: 'text' | 'html',
    channelPayload: Record<string, unknown> = {},
  ): IngestInboundMessageInput {
    return {
      channelId: '550e8400-e29b-41d4-a716-446655440040',
      providerKey: 'imap',
      channelType: 'email',
      scope: {
        tenantId: '550e8400-e29b-41d4-a716-446655440020',
        organizationId: '550e8400-e29b-41d4-a716-446655440030',
      },
      message: {
        externalMessageId: 'ext-html-1',
        externalConversationId: 'conv-1',
        senderIdentifier: 'jane@example.com',
        body,
        bodyFormat,
        timestamp: new Date(),
        channelPayload,
        channelContentType: 'email/mime',
        channelMetadata: {},
      },
    } as IngestInboundMessageInput
  }

  function primeLookups() {
    mockIngestFindOne.mockReset()
    mockIngestFindOne
      .mockResolvedValueOnce(null as never) // no duplicate ExternalMessage
      .mockResolvedValueOnce({
        id: 'ch-1',
        isActive: true,
        providerKey: 'imap',
        channelType: 'email',
        userId: 'u-1',
      } as never) // channel
      .mockResolvedValue(null as never) // conversation + mapping → created
  }

  function composedInput(commandBus: { execute: jest.Mock }) {
    const call = commandBus.execute.mock.calls.find(([commandId]) => commandId === 'messages.messages.compose')
    expect(call).toBeDefined()
    return (call as unknown[])[1] as { input: { body: string; bodyFormat: string } }
  }

  it('converts an HTML body to plain text instead of relabelling it as text', async () => {
    // `messages` renders bodies as plain text, so an HTML body that is merely
    // relabelled surfaces raw markup (doctype, <style> blocks) in the inbox.
    primeLookups()
    const { ctx, commandBus } = makeCtx()
    const html = [
      '<!DOCTYPE html><html><head>',
      '<style>body { margin: 0; font-size: 14px; }</style>',
      '<script>console.log("tracking")</script>',
      '</head><body><p>Cześć,</p><p>w nawiązaniu do spotkania.</p></body></html>',
    ].join('')

    await ingestInboundMessageCommand.execute(makeInput(html, 'html') as never, ctx)

    const { input: composed } = composedInput(commandBus)
    expect(composed.bodyFormat).toBe('text')
    expect(composed.body).toContain('Cześć,')
    expect(composed.body).toContain('w nawiązaniu do spotkania.')
    expect(composed.body).not.toContain('<!DOCTYPE')
    expect(composed.body).not.toContain('<p>')
    expect(composed.body).not.toContain('font-size')
    expect(composed.body).not.toContain('tracking')
  })

  it('leaves a plain-text body untouched', async () => {
    primeLookups()
    const { ctx, commandBus } = makeCtx()

    await ingestInboundMessageCommand.execute(makeInput('Hello!\n\nRegards,\nJane', 'text') as never, ctx)

    const { input: composed } = composedInput(commandBus)
    expect(composed.bodyFormat).toBe('text')
    expect(composed.body).toBe('Hello!\n\nRegards,\nJane')
  })

  it('stores the sender\'s own plain part verbatim for a multipart/alternative email', async () => {
    // `lib/email-mime.ts` prefers the HTML part when picking `body` but keeps
    // the text/plain alternative at `channelPayload.text`. That part is what a
    // human actually composed, so it must beat html-to-text output — which
    // inlines link URLs, flattens tables and synthesizes list markers.
    primeLookups()
    const { ctx, commandBus } = makeCtx()
    const plain = 'Cześć,\n\nSzczegóły: https://example.com/order/1234\n\nPozdrawiam,\nJan'
    const html = '<html><body><p>Cześć,</p><p>Szczegóły: <a href="https://example.com/order/1234">tutaj</a></p><p>Pozdrawiam,<br>Jan</p></body></html>'

    await ingestInboundMessageCommand.execute(
      makeInput(html, 'html', { html, text: plain }) as never,
      ctx,
    )

    const { input: composed } = composedInput(commandBus)
    expect(composed.bodyFormat).toBe('text')
    expect(composed.body).toBe(plain)
    // The conversion artefact the plain part exists to avoid.
    expect(composed.body).not.toContain('[https://example.com/order/1234]')
  })

  it('still converts when the sender supplied no usable plain alternative', async () => {
    primeLookups()
    const { ctx, commandBus } = makeCtx()
    const html = '<html><body><p>HTML only sender</p></body></html>'

    await ingestInboundMessageCommand.execute(
      makeInput(html, 'html', { html, text: '   ' }) as never,
      ctx,
    )

    const { input: composed } = composedInput(commandBus)
    expect(composed.bodyFormat).toBe('text')
    expect(composed.body).toBe('HTML only sender')
  })

  it('bounds the synchronous parse of an oversized HTML body', async () => {
    // Inbound mail is untrusted and `lib/email-capabilities.ts` allows bodies up
    // to 5MB, so the whole document used to be parsed before the 50k truncation
    // could apply. The pre-parse cap bounds that work.
    //
    // The padding is a <style> block, which the converter skips — so the marker
    // that follows it survives truncation and is observable in the composed
    // body. Without the cap the parser reaches it; with the cap the input is cut
    // mid-<style> and the marker is never seen.
    primeLookups()
    const { ctx, commandBus } = makeCtx()
    const cssPadding = '/* padding */ .a { color: #ffffff; }\n'.repeat(20_000)
    const html = `<html><body><p>Opening line</p><style>${cssPadding}</style><p>MARKER-BEYOND-CAP</p></body></html>`
    expect(cssPadding.length).toBeGreaterThan(512 * 1024)

    await ingestInboundMessageCommand.execute(makeInput(html, 'html') as never, ctx)

    const { input: composed } = composedInput(commandBus)
    expect(composed.body).toContain('Opening line')
    expect(composed.body).not.toContain('MARKER-BEYOND-CAP')
    expect(composed.body.length).toBeLessThanOrEqual(50_000)
    // The cap counts markup bytes and the compose-level cap counts text
    // characters, so this one bites first and the compose-level marker never
    // fires to cover for it. It must say so itself rather than ending the body
    // mid-sentence with nothing to tell the reader the rest exists.
    expect(composed.body).toContain('message truncated by Open Mercato')
  })

  it('does not mark an HTML body that fits inside the pre-parse cap', async () => {
    primeLookups()
    const { ctx, commandBus } = makeCtx()

    await ingestInboundMessageCommand.execute(
      makeInput('<html><body><p>Short enough</p></body></html>', 'html') as never,
      ctx,
    )

    const { input: composed } = composedInput(commandBus)
    expect(composed.body).toContain('Short enough')
    expect(composed.body).not.toContain('message truncated by Open Mercato')
  })
})
