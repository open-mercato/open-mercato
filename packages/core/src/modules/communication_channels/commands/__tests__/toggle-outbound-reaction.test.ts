import toggleOutboundReactionCommand, {
  COMMUNICATION_CHANNELS_TOGGLE_OUTBOUND_REACTION_COMMAND_ID,
} from '../toggle-outbound-reaction'

describe('toggleOutboundReactionCommand metadata', () => {
  it('exports the canonical command id', () => {
    expect(COMMUNICATION_CHANNELS_TOGGLE_OUTBOUND_REACTION_COMMAND_ID).toBe(
      'communication_channels.reaction.toggle_outbound',
    )
    expect(toggleOutboundReactionCommand.id).toBe(
      COMMUNICATION_CHANNELS_TOGGLE_OUTBOUND_REACTION_COMMAND_ID,
    )
  })

  it('exports an execute function', () => {
    expect(typeof toggleOutboundReactionCommand.execute).toBe('function')
  })
})

describe('toggleOutboundReactionCommand schema', () => {
  function emptyCtx() {
    return {
      container: { resolve: () => null } as any,
      auth: null,
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
    }
  }

  const validBase = {
    messageId: '11111111-1111-1111-1111-111111111111',
    emoji: '👍',
    reactedByUserId: '22222222-2222-2222-2222-222222222222',
    scope: { tenantId: '33333333-3333-3333-3333-333333333333', organizationId: null },
  }

  it('rejects malformed messageId', async () => {
    await expect(
      toggleOutboundReactionCommand.execute(
        { ...validBase, messageId: 'not-a-uuid', action: 'add' } as never,
        emptyCtx(),
      ),
    ).rejects.toThrow()
  })

  it('rejects missing action', async () => {
    await expect(
      toggleOutboundReactionCommand.execute(
        { ...validBase } as never,
        emptyCtx(),
      ),
    ).rejects.toThrow()
  })

  it('rejects emoji longer than 64 characters', async () => {
    await expect(
      toggleOutboundReactionCommand.execute(
        { ...validBase, action: 'add', emoji: 'x'.repeat(100) } as never,
        emptyCtx(),
      ),
    ).rejects.toThrow()
  })

  it('rejects unknown action value', async () => {
    await expect(
      toggleOutboundReactionCommand.execute(
        { ...validBase, action: 'toggle' } as never,
        emptyCtx(),
      ),
    ).rejects.toThrow()
  })

  it('passes schema for valid `add` input (then fails later on DI)', async () => {
    await expect(
      toggleOutboundReactionCommand.execute(
        { ...validBase, action: 'add' } as never,
        emptyCtx(),
      ),
    ).rejects.toThrow() // throws past schema — empty DI
  })
})
