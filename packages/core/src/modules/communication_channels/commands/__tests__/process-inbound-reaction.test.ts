import processInboundReactionCommand, {
  COMMUNICATION_CHANNELS_PROCESS_INBOUND_REACTION_COMMAND_ID,
} from '../process-inbound-reaction'

describe('processInboundReactionCommand metadata', () => {
  it('exports the canonical command id', () => {
    expect(COMMUNICATION_CHANNELS_PROCESS_INBOUND_REACTION_COMMAND_ID).toBe(
      'communication_channels.reaction.process_inbound',
    )
    expect(processInboundReactionCommand.id).toBe(
      COMMUNICATION_CHANNELS_PROCESS_INBOUND_REACTION_COMMAND_ID,
    )
  })

  it('exports an execute function', () => {
    expect(typeof processInboundReactionCommand.execute).toBe('function')
  })
})

describe('processInboundReactionCommand schema', () => {
  function emptyCtx() {
    return {
      container: { resolve: () => null } as any,
      auth: null,
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
    }
  }

  it('rejects missing channelId', async () => {
    await expect(
      processInboundReactionCommand.execute(
        {
          providerKey: 'slack',
          channelType: 'chat',
          scope: { tenantId: '11111111-1111-1111-1111-111111111111', organizationId: null },
          event: {
            externalMessageId: 'ext-1',
            emoji: '👍',
            userIdentifier: 'U1',
            action: 'added',
          },
        } as never,
        emptyCtx(),
      ),
    ).rejects.toThrow()
  })

  it('rejects missing emoji', async () => {
    await expect(
      processInboundReactionCommand.execute(
        {
          channelId: '11111111-1111-1111-1111-111111111111',
          providerKey: 'slack',
          channelType: 'chat',
          scope: { tenantId: '22222222-2222-2222-2222-222222222222', organizationId: null },
          event: {
            externalMessageId: 'ext-1',
            userIdentifier: 'U1',
            action: 'added',
          },
        } as never,
        emptyCtx(),
      ),
    ).rejects.toThrow()
  })

  it('rejects invalid action', async () => {
    await expect(
      processInboundReactionCommand.execute(
        {
          channelId: '11111111-1111-1111-1111-111111111111',
          providerKey: 'slack',
          channelType: 'chat',
          scope: { tenantId: '22222222-2222-2222-2222-222222222222', organizationId: null },
          event: {
            externalMessageId: 'ext-1',
            emoji: '👍',
            userIdentifier: 'U1',
            action: 'toggled',
          },
        } as never,
        emptyCtx(),
      ),
    ).rejects.toThrow()
  })
})
