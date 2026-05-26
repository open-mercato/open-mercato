import ingestInboundMessageCommand, {
  COMMUNICATION_CHANNELS_INGEST_INBOUND_COMMAND_ID,
  type IngestInboundMessageInput,
} from '../ingest-inbound-message'

describe('ingestInboundMessageCommand metadata', () => {
  it('exports the canonical command id', () => {
    expect(COMMUNICATION_CHANNELS_INGEST_INBOUND_COMMAND_ID).toBe(
      'communication_channels.ingest_inbound_message',
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
