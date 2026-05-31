const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

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

describe('toggleOutboundReactionCommand per-user ownership gate', () => {
  // Valid UUIDs (version + variant digits) so the Zod schema passes and execution
  // reaches the ownership gate — the existing schema tests above use all-same-digit
  // ids that intentionally fail validation.
  const tenantId = '33333333-3333-3333-8333-333333333333'
  const messageId = '11111111-1111-1111-8111-111111111111'
  const owner = '44444444-4444-4444-8444-444444444444'
  const attacker = '22222222-2222-2222-8222-222222222222'

  function ctxWithEm() {
    // findOneWithDecryption / findWithDecryption are mocked, so `em` is unused.
    return {
      container: {
        resolve: ((name: string) => (name === 'em' ? { fork: () => ({}) } : null)) as <T>(
          name: string,
        ) => T,
      } as never,
      auth: null,
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
    }
  }

  // The command resolves four rows in order: Message, MessageChannelLink,
  // ChannelThreadMapping, CommunicationChannel.
  function primeResolution(channel: { id: string; userId: string | null }) {
    mockFindOneWithDecryption
      .mockResolvedValueOnce({ id: messageId, threadId: messageId })
      .mockResolvedValueOnce({ id: 'link-1', providerKey: 'imap', channelType: 'email' })
      .mockResolvedValueOnce({ channelId: channel.id })
      .mockResolvedValueOnce({ ...channel, capabilities: null })
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('refuses to react FROM a per-user channel owned by another user (no impersonation)', async () => {
    // Regression guard: the reaction is delivered with the CHANNEL OWNER's
    // credentials, so a non-owner must NOT be able to react from someone else's
    // connected account. (CVE-class: cross-user send-as.)
    primeResolution({ id: 'ch-owner', userId: owner })
    const result = await toggleOutboundReactionCommand.execute(
      {
        messageId,
        emoji: '👍',
        action: 'add',
        reactedByUserId: attacker,
        scope: { tenantId, organizationId: null },
      } as never,
      ctxWithEm(),
    )
    expect(result).toEqual({ status: 'not_owner', reason: expect.any(String) })
    // Must short-circuit BEFORE inserting a reaction row or enqueuing a provider job.
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  it('lets the channel OWNER react (passes the ownership gate)', async () => {
    primeResolution({ id: 'ch-owner', userId: owner })
    // Owner passes the gate and proceeds into the add path, which touches the
    // (empty) em — so it throws rather than returning `not_owner`. The point is
    // it does NOT short-circuit as not_owner.
    await expect(
      toggleOutboundReactionCommand.execute(
        {
          messageId,
          emoji: '👍',
          action: 'add',
          reactedByUserId: owner,
          scope: { tenantId, organizationId: null },
        } as never,
        ctxWithEm(),
      ),
    ).rejects.toThrow()
  })

  it('lets any authorized user react on a tenant-wide (shared, ownerless) channel', async () => {
    primeResolution({ id: 'ch-shared', userId: null })
    await expect(
      toggleOutboundReactionCommand.execute(
        {
          messageId,
          emoji: '👍',
          action: 'add',
          reactedByUserId: attacker,
          scope: { tenantId, organizationId: null },
        } as never,
        ctxWithEm(),
      ),
    ).rejects.toThrow() // passes the gate (shared channel) → add path → empty em throws
  })
})
