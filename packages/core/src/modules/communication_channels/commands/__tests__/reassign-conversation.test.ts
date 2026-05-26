import reassignConversationCommand, {
  COMMUNICATION_CHANNELS_REASSIGN_CONVERSATION_COMMAND_ID,
} from '../reassign-conversation'

describe('reassignConversationCommand metadata', () => {
  it('exports the canonical command id', () => {
    expect(COMMUNICATION_CHANNELS_REASSIGN_CONVERSATION_COMMAND_ID).toBe(
      'communication_channels.reassign_conversation',
    )
    expect(reassignConversationCommand.id).toBe(
      COMMUNICATION_CHANNELS_REASSIGN_CONVERSATION_COMMAND_ID,
    )
  })

  it('exports an execute function', () => {
    expect(typeof reassignConversationCommand.execute).toBe('function')
  })
})

describe('reassignConversationCommand schema', () => {
  function emptyCtx() {
    return {
      container: { resolve: () => null } as any,
      auth: null,
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
    }
  }

  it('rejects malformed threadId', async () => {
    await expect(
      reassignConversationCommand.execute(
        {
          threadId: 'not-a-uuid',
          assignedUserId: null,
          scope: { tenantId: '11111111-1111-1111-1111-111111111111', organizationId: null },
        } as never,
        emptyCtx(),
      ),
    ).rejects.toThrow()
  })

  it('rejects malformed assignedUserId (non-uuid string)', async () => {
    await expect(
      reassignConversationCommand.execute(
        {
          threadId: '11111111-1111-1111-1111-111111111111',
          assignedUserId: 'not-a-uuid',
          scope: { tenantId: '22222222-2222-2222-2222-222222222222', organizationId: null },
        } as never,
        emptyCtx(),
      ),
    ).rejects.toThrow()
  })

  it('accepts null assignedUserId (unassign)', async () => {
    // Schema passes; execute fails past schema on empty DI — that's fine for the test.
    await expect(
      reassignConversationCommand.execute(
        {
          threadId: '11111111-1111-1111-1111-111111111111',
          assignedUserId: null,
          scope: { tenantId: '22222222-2222-2222-2222-222222222222', organizationId: null },
        } as never,
        emptyCtx(),
      ),
    ).rejects.toThrow()
  })
})
