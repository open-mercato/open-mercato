import connectCredentialChannelCommand, {
  COMMUNICATION_CHANNELS_CONNECT_CREDENTIAL_CHANNEL_COMMAND_ID,
} from '../connect-credential-channel'

describe('connectCredentialChannelCommand metadata', () => {
  it('exports stable canonical command id', () => {
    expect(COMMUNICATION_CHANNELS_CONNECT_CREDENTIAL_CHANNEL_COMMAND_ID).toBe(
      'communication_channels.channel.connect_credential',
    )
    expect(connectCredentialChannelCommand.id).toBe(
      COMMUNICATION_CHANNELS_CONNECT_CREDENTIAL_CHANNEL_COMMAND_ID,
    )
  })
})

describe('connectCredentialChannelCommand schema', () => {
  function emptyCtx() {
    return {
      container: { resolve: () => null } as any,
      auth: null,
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
    }
  }

  it('rejects missing providerKey', async () => {
    await expect(
      connectCredentialChannelCommand.execute(
        {
          displayName: 'IMAP',
          credentials: { username: 'a', password: 'b' },
          userId: '11111111-1111-1111-1111-111111111111',
          scope: { tenantId: '22222222-2222-2222-2222-222222222222', organizationId: null },
        } as never,
        emptyCtx(),
      ),
    ).rejects.toThrow()
  })

  it('rejects pollIntervalSeconds out of range', async () => {
    await expect(
      connectCredentialChannelCommand.execute(
        {
          providerKey: 'imap',
          displayName: 'IMAP',
          credentials: { username: 'a' },
          pollIntervalSeconds: 0,
          userId: '11111111-1111-1111-1111-111111111111',
          scope: { tenantId: '22222222-2222-2222-2222-222222222222', organizationId: null },
        } as never,
        emptyCtx(),
      ),
    ).rejects.toThrow()
    await expect(
      connectCredentialChannelCommand.execute(
        {
          providerKey: 'imap',
          displayName: 'IMAP',
          credentials: { username: 'a' },
          pollIntervalSeconds: 86_401,
          userId: '11111111-1111-1111-1111-111111111111',
          scope: { tenantId: '22222222-2222-2222-2222-222222222222', organizationId: null },
        } as never,
        emptyCtx(),
      ),
    ).rejects.toThrow()
  })

  it('rejects non-uuid userId', async () => {
    await expect(
      connectCredentialChannelCommand.execute(
        {
          providerKey: 'imap',
          displayName: 'IMAP',
          credentials: { username: 'a' },
          userId: 'not-a-uuid',
          scope: { tenantId: '22222222-2222-2222-2222-222222222222', organizationId: null },
        } as never,
        emptyCtx(),
      ),
    ).rejects.toThrow()
  })
})
