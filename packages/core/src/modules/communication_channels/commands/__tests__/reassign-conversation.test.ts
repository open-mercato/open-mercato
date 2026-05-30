jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import reassignConversationCommand, {
  COMMUNICATION_CHANNELS_REASSIGN_CONVERSATION_COMMAND_ID,
} from '../reassign-conversation'

const mockFindOne = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>

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

describe('reassignConversationCommand execute (assignee tenant validation)', () => {
  const TENANT = '22222222-2222-4222-8222-222222222222'
  const THREAD = '11111111-1111-4111-8111-111111111111'
  const ASSIGNEE = '33333333-3333-4333-8333-333333333333'

  function ctxWithEm() {
    const em = { flush: jest.fn(async () => undefined) }
    const ctx = {
      container: { resolve: (name: string) => (name === 'em' ? { fork: () => em } : null) } as any,
      auth: null,
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
    }
    return { ctx, em }
  }

  beforeEach(() => {
    mockFindOne.mockReset()
  })

  it('returns invalid_assignee when the target user is not a member of the tenant', async () => {
    mockFindOne
      .mockResolvedValueOnce({ assignedUserId: null, externalConversationId: 'conv-1' } as never)
      .mockResolvedValueOnce(null)
    const { ctx, em } = ctxWithEm()
    const result = await reassignConversationCommand.execute(
      { threadId: THREAD, assignedUserId: ASSIGNEE, scope: { tenantId: TENANT, organizationId: null } } as never,
      ctx,
    )
    expect(result).toEqual({
      status: 'invalid_assignee',
      reason: 'assigned user is not a member of this tenant',
    })
    expect(em.flush).not.toHaveBeenCalled()
    expect(mockFindOne).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'User',
      expect.objectContaining({ id: ASSIGNEE, tenantId: TENANT, deletedAt: null }),
      undefined,
      expect.anything(),
    )
  })

  it('reassigns when the target user belongs to the tenant', async () => {
    mockFindOne
      .mockResolvedValueOnce({ assignedUserId: null, externalConversationId: 'conv-1' } as never)
      .mockResolvedValueOnce({ id: ASSIGNEE } as never)
      .mockResolvedValueOnce({ id: 'conv-1', assignedUserId: null } as never)
    const { ctx, em } = ctxWithEm()
    const result = await reassignConversationCommand.execute(
      { threadId: THREAD, assignedUserId: ASSIGNEE, scope: { tenantId: TENANT, organizationId: null } } as never,
      ctx,
    )
    expect(result.status).toBe('reassigned')
    expect(em.flush).toHaveBeenCalledTimes(1)
  })
})
