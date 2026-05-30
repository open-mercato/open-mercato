import setPrimaryChannelCommand, {
  COMMUNICATION_CHANNELS_SET_PRIMARY_COMMAND_ID,
} from '../set-primary-channel'

describe('setPrimaryChannelCommand metadata', () => {
  it('exports stable canonical command id', () => {
    expect(COMMUNICATION_CHANNELS_SET_PRIMARY_COMMAND_ID).toBe(
      'communication_channels.channel.set_primary',
    )
    expect(setPrimaryChannelCommand.id).toBe(COMMUNICATION_CHANNELS_SET_PRIMARY_COMMAND_ID)
  })
})

describe('setPrimaryChannelCommand schema', () => {
  function emptyCtx() {
    return {
      container: { resolve: () => null } as any,
      auth: null,
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
    }
  }

  it('rejects malformed channelId', async () => {
    await expect(
      setPrimaryChannelCommand.execute(
        {
          channelId: 'not-a-uuid',
          userId: '11111111-1111-1111-1111-111111111111',
          scope: { tenantId: '22222222-2222-2222-2222-222222222222', organizationId: null },
        } as never,
        emptyCtx(),
      ),
    ).rejects.toThrow()
  })

  it('rejects malformed userId', async () => {
    await expect(
      setPrimaryChannelCommand.execute(
        {
          channelId: '11111111-1111-1111-1111-111111111111',
          userId: 'not-a-uuid',
          scope: { tenantId: '22222222-2222-2222-2222-222222222222', organizationId: null },
        } as never,
        emptyCtx(),
      ),
    ).rejects.toThrow()
  })
})
