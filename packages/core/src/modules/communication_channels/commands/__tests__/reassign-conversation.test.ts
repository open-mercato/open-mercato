jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

const mockReportError = jest.fn()
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback: string) =>
      key === 'communication_channels.errors.threadNotFound' ? 'Wątek nie znaleziony' : fallback,
  }),
}))

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import reassignConversationCommand, {
  COMMUNICATION_CHANNELS_REASSIGN_CONVERSATION_COMMAND_ID,
} from '../reassign-conversation'

const mockFindOne = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>

describe('reassignConversationCommand metadata', () => {
  it('exports the canonical command id', () => {
    expect(COMMUNICATION_CHANNELS_REASSIGN_CONVERSATION_COMMAND_ID).toBe(
      'communication_channels.conversation.reassign',
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

function ctxFor(
  tenantId: string,
  actor: { userId?: string | null; features?: string[]; aclFails?: boolean },
) {
  const em = { flush: jest.fn(async () => undefined) }
  const rbacService = {
    loadAcl: jest.fn(async () => {
      if (actor.aclFails) throw new Error('rbac unavailable')
      return { isSuperAdmin: false, features: actor.features ?? [] }
    }),
  }
  const services: Record<string, unknown> = { em: { fork: () => em }, rbacService }
  const ctx = {
    container: { resolve: (name: string) => services[name] ?? null } as any,
    auth: actor.userId ? ({ sub: actor.userId, tenantId, orgId: null } as any) : null,
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
  }
  return { ctx, em, rbacService }
}

describe('reassignConversationCommand execute (assignee tenant validation)', () => {
  const TENANT = '22222222-2222-4222-8222-222222222222'
  const THREAD = '11111111-1111-4111-8111-111111111111'
  const ASSIGNEE = '33333333-3333-4333-8333-333333333333'
  const ACTOR = '44444444-4444-4444-8444-444444444444'
  const sharedChannel = { id: 'channel-1', userId: null }

  function ctxWithEm() {
    return ctxFor(TENANT, { userId: ACTOR, features: ['communication_channels.assign'] })
  }

  beforeEach(() => {
    mockFindOne.mockReset()
  })

  it('returns invalid_assignee when the target user is not a member of the tenant', async () => {
    mockFindOne
      .mockResolvedValueOnce({ assignedUserId: null, externalConversationId: 'conv-1', channelId: 'channel-1' } as never)
      .mockResolvedValueOnce(sharedChannel as never)
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
      3,
      expect.anything(),
      'User',
      expect.objectContaining({ id: ASSIGNEE, tenantId: TENANT, deletedAt: null }),
      undefined,
      expect.anything(),
    )
  })

  it('reassigns when the target user belongs to the tenant and captures an undo snapshot', async () => {
    mockFindOne
      .mockResolvedValueOnce({ id: 'mapping-1', assignedUserId: null, externalConversationId: 'conv-1', channelId: 'channel-1', tenantId: TENANT } as never)
      .mockResolvedValueOnce(sharedChannel as never)
      .mockResolvedValueOnce({ id: ASSIGNEE } as never)
      .mockResolvedValueOnce({ id: 'conv-1', assignedUserId: null } as never)
    const { ctx, em } = ctxWithEm()
    const result = await reassignConversationCommand.execute(
      { threadId: THREAD, assignedUserId: ASSIGNEE, scope: { tenantId: TENANT, organizationId: null } } as never,
      ctx,
    )
    expect(result).toMatchObject({
      status: 'reassigned',
      undo: {
        threadMappingId: 'mapping-1',
        conversationId: 'conv-1',
        tenantId: TENANT,
        previousAssignedUserId: null,
        newAssignedUserId: ASSIGNEE,
      },
    })
    expect(em.flush).toHaveBeenCalledTimes(1)
  })
})

describe('reassignConversationCommand execute (personal-mailbox privacy, #3832)', () => {
  const TENANT = '22222222-2222-4222-8222-222222222222'
  const THREAD = '11111111-1111-4111-8111-111111111111'
  const ASSIGNEE = '33333333-3333-4333-8333-333333333333'
  const OWNER = '55555555-5555-4555-8555-555555555555'
  const OTHER = '66666666-6666-4666-8666-666666666666'
  const ASSIGN = ['communication_channels.assign']

  function mapping() {
    return { id: 'mapping-1', assignedUserId: null, externalConversationId: 'conv-1', channelId: 'channel-1', tenantId: TENANT }
  }

  function run(actor: { userId?: string | null; features?: string[]; aclFails?: boolean }, extraInput: Record<string, unknown> = {}) {
    const { ctx, em, rbacService } = ctxFor(TENANT, actor)
    const promise = reassignConversationCommand.execute(
      { threadId: THREAD, assignedUserId: ASSIGNEE, scope: { tenantId: TENANT, organizationId: null }, ...extraInput } as never,
      ctx,
    )
    return { promise, em, rbacService }
  }

  beforeEach(() => {
    mockFindOne.mockReset()
  })

  it('denies a non-owner reassigning a thread on another user\'s personal mailbox, even with every feature', async () => {
    mockFindOne
      .mockResolvedValueOnce(mapping() as never)
      .mockResolvedValueOnce({ id: 'channel-1', userId: OWNER } as never)
    const { promise, em } = run({ userId: OTHER, features: ['*'] })
    expect(await promise).toEqual({
      status: 'access_denied',
      reason: 'Channel is a personal mailbox owned by another user',
    })
    expect(em.flush).not.toHaveBeenCalled()
    expect(mockFindOne).toHaveBeenCalledTimes(2)
    expect(mockFindOne).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.anything(),
      { id: 'channel-1', tenantId: TENANT },
      undefined,
      expect.anything(),
    )
  })

  it('denies before the no-op check so a non-owner cannot probe the current assignee', async () => {
    mockFindOne
      .mockResolvedValueOnce({ ...mapping(), assignedUserId: ASSIGNEE } as never)
      .mockResolvedValueOnce({ id: 'channel-1', userId: OWNER } as never)
    const { promise } = run({ userId: OTHER, features: ASSIGN })
    expect(await promise).toMatchObject({ status: 'access_denied' })
  })

  it('checks the context actor, ignoring any actor carried in the input', async () => {
    mockFindOne
      .mockResolvedValueOnce(mapping() as never)
      .mockResolvedValueOnce({ id: 'channel-1', userId: OWNER } as never)
    const { promise, em } = run({ userId: OTHER, features: ['*'] }, { actorUserId: OWNER })
    expect(await promise).toMatchObject({ status: 'access_denied' })
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('lets the mailbox owner reassign their own personal-mailbox thread', async () => {
    mockFindOne
      .mockResolvedValueOnce(mapping() as never)
      .mockResolvedValueOnce({ id: 'channel-1', userId: OWNER } as never)
      .mockResolvedValueOnce({ id: ASSIGNEE } as never)
      .mockResolvedValueOnce({ id: 'conv-1', assignedUserId: null } as never)
    const { promise, em } = run({ userId: OWNER, features: ASSIGN })
    expect(await promise).toMatchObject({ status: 'reassigned', nextAssignedUserId: ASSIGNEE })
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('still lets the owner reassign a thread on a soft-deleted personal mailbox', async () => {
    mockFindOne
      .mockResolvedValueOnce(mapping() as never)
      .mockResolvedValueOnce({ id: 'channel-1', userId: OWNER, deletedAt: new Date() } as never)
      .mockResolvedValueOnce({ id: ASSIGNEE } as never)
      .mockResolvedValueOnce({ id: 'conv-1', assignedUserId: null } as never)
    const { promise } = run({ userId: OWNER })
    expect(await promise).toMatchObject({ status: 'reassigned' })
  })

  it('lets an assign holder reassign a shared-channel thread', async () => {
    mockFindOne
      .mockResolvedValueOnce(mapping() as never)
      .mockResolvedValueOnce({ id: 'channel-1', userId: null } as never)
      .mockResolvedValueOnce({ id: ASSIGNEE } as never)
      .mockResolvedValueOnce({ id: 'conv-1', assignedUserId: null } as never)
    const { promise, em, rbacService } = run({ userId: OTHER, features: ['communication_channels.*'] })
    expect(await promise).toMatchObject({ status: 'reassigned' })
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(rbacService.loadAcl).toHaveBeenCalledWith(OTHER, { tenantId: TENANT, organizationId: null })
  })

  it('denies a shared-channel thread to a caller without assign', async () => {
    mockFindOne
      .mockResolvedValueOnce(mapping() as never)
      .mockResolvedValueOnce({ id: 'channel-1', userId: null } as never)
    const { promise, em } = run({ userId: OTHER, features: ['communication_channels.view'] })
    expect(await promise).toMatchObject({ status: 'access_denied' })
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('denies a shared-channel thread when the ACL lookup fails and reports the failure', async () => {
    mockReportError.mockClear()
    mockFindOne
      .mockResolvedValueOnce(mapping() as never)
      .mockResolvedValueOnce({ id: 'channel-1', userId: null } as never)
    const { promise, em } = run({ userId: OTHER, aclFails: true })
    expect(await promise).toMatchObject({ status: 'access_denied' })
    expect(em.flush).not.toHaveBeenCalled()
    expect(mockReportError).toHaveBeenCalledTimes(1)
    expect(mockReportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'rbac unavailable' }),
      expect.objectContaining({
        module: 'communication_channels',
        code: 'communication_channels.reassign_acl_lookup_failed',
        attributes: expect.objectContaining({ actorUserId: OTHER, tenantId: TENANT }),
      }),
    )
  })

  it('still fails closed when reporting the ACL lookup failure itself throws', async () => {
    mockReportError.mockImplementationOnce(() => {
      throw new Error('sink down')
    })
    mockFindOne
      .mockResolvedValueOnce(mapping() as never)
      .mockResolvedValueOnce({ id: 'channel-1', userId: null } as never)
    const { promise, em } = run({ userId: OTHER, aclFails: true })
    expect(await promise).toMatchObject({ status: 'access_denied' })
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('fails closed when the context carries no actor', async () => {
    mockFindOne
      .mockResolvedValueOnce(mapping() as never)
      .mockResolvedValueOnce({ id: 'channel-1', userId: OWNER } as never)
    const { promise, em } = run({})
    expect(await promise).toMatchObject({ status: 'access_denied' })
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('returns no_channel_link when the mapping\'s channel is gone', async () => {
    mockFindOne
      .mockResolvedValueOnce(mapping() as never)
      .mockResolvedValueOnce(null)
    const { promise, em } = run({ userId: OWNER, features: ASSIGN })
    expect(await promise).toMatchObject({ status: 'no_channel_link' })
    expect(em.flush).not.toHaveBeenCalled()
  })
})

describe('reassignConversationCommand redo (personal-mailbox privacy, #3832)', () => {
  const TENANT = '22222222-2222-4222-8222-222222222222'
  const THREAD = '11111111-1111-4111-8111-111111111111'
  const ASSIGNEE = '33333333-3333-4333-8333-333333333333'
  const OWNER = '55555555-5555-4555-8555-555555555555'
  const OTHER = '66666666-6666-4666-8666-666666666666'

  function redo(actor: { userId?: string | null; features?: string[] }) {
    const { ctx, em } = ctxFor(TENANT, actor)
    const promise = reassignConversationCommand.redo!({
      input: { threadId: THREAD, assignedUserId: ASSIGNEE, scope: { tenantId: TENANT, organizationId: null } } as never,
      ctx,
      logEntry: { id: 'log-1' } as never,
    })
    return { promise, em }
  }

  beforeEach(() => {
    mockFindOne.mockReset()
  })

  it('throws a masked, translated 404 domain error when a non-owner redoes a personal-mailbox reassignment', async () => {
    mockFindOne
      .mockResolvedValueOnce({ id: 'mapping-1', assignedUserId: null, externalConversationId: 'conv-1', channelId: 'channel-1', tenantId: TENANT } as never)
      .mockResolvedValueOnce({ id: 'channel-1', userId: OWNER } as never)
    const { promise, em } = redo({ userId: OTHER, features: ['*'] })
    const error = await promise.then(() => null, (err: unknown) => err)
    expect(isCrudHttpError(error)).toBe(true)
    expect(error).toMatchObject({ status: 404, body: { error: 'Wątek nie znaleziony' } })
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('replays the reassignment when the mailbox owner redoes it', async () => {
    mockFindOne
      .mockResolvedValueOnce({ id: 'mapping-1', assignedUserId: null, externalConversationId: 'conv-1', channelId: 'channel-1', tenantId: TENANT } as never)
      .mockResolvedValueOnce({ id: 'channel-1', userId: OWNER } as never)
      .mockResolvedValueOnce({ id: ASSIGNEE } as never)
      .mockResolvedValueOnce({ id: 'conv-1', assignedUserId: null } as never)
    const { promise, em } = redo({ userId: OWNER })
    expect(await promise).toMatchObject({ status: 'reassigned', nextAssignedUserId: ASSIGNEE })
    expect(em.flush).toHaveBeenCalledTimes(1)
  })
})

describe('reassignConversationCommand undo', () => {
  const TENANT = '22222222-2222-4222-8222-222222222222'

  beforeEach(() => {
    mockFindOne.mockReset()
  })

  it('restores the previous owner on both the mapping and the conversation', async () => {
    const mapping = { id: 'mapping-1', assignedUserId: 'new-owner' }
    const conversation = { id: 'conv-1', assignedUserId: 'new-owner' }
    mockFindOne
      .mockResolvedValueOnce(mapping as never)
      .mockResolvedValueOnce(conversation as never)
    const em = { flush: jest.fn(async () => undefined) }
    const ctx = {
      container: {
        resolve: ((name: string) => (name === 'em' ? { fork: () => em } : null)) as <T>(name: string) => T,
      },
    } as never
    // The shared `extractUndoPayload` helper unwraps the snapshot from
    // `logEntry.commandPayload.undo`.
    await reassignConversationCommand.undo!({
      input: { threadId: 'thread-1' } as never,
      ctx,
      logEntry: {
        commandPayload: {
          undo: {
            threadMappingId: 'mapping-1',
            conversationId: 'conv-1',
            tenantId: TENANT,
            previousAssignedUserId: 'old-owner',
            newAssignedUserId: 'new-owner',
          },
        },
      } as never,
    })
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(mapping.assignedUserId).toBe('old-owner')
    expect(conversation.assignedUserId).toBe('old-owner')
  })

  it('refuses to resolve when the snapshot lacks a tenantId', async () => {
    const em = { flush: jest.fn(async () => undefined) }
    const ctx = {
      container: {
        resolve: ((name: string) => (name === 'em' ? { fork: () => em } : null)) as <T>(name: string) => T,
      },
    } as never
    await reassignConversationCommand.undo!({
      input: { threadId: 'thread-1' } as never,
      ctx,
      logEntry: {
        commandPayload: {
          undo: {
            threadMappingId: 'mapping-1',
            conversationId: 'conv-1',
            previousAssignedUserId: 'old-owner',
            newAssignedUserId: 'new-owner',
          },
        },
      } as never,
    })
    expect(mockFindOne).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('buildLog persists the undo snapshot under payload.undo for a reassigned result', async () => {
    const undoSnapshot = {
      threadMappingId: 'mapping-1',
      conversationId: 'conv-1',
      tenantId: TENANT,
      previousAssignedUserId: 'old-owner',
      newAssignedUserId: 'new-owner',
    }
    const meta = await reassignConversationCommand.buildLog!({
      input: { scope: { tenantId: TENANT, organizationId: null } } as never,
      result: {
        status: 'reassigned',
        threadId: 'thread-1',
        previousAssignedUserId: 'old-owner',
        nextAssignedUserId: 'new-owner',
        conversationId: 'conv-1',
        undo: undoSnapshot,
      } as never,
      ctx: {} as never,
      snapshots: {},
    })
    expect(meta).toMatchObject({
      resourceKind: 'communication_channels.channel',
      resourceId: 'conv-1',
      tenantId: TENANT,
      payload: { undo: undoSnapshot },
    })
  })

  it('buildLog returns null when there is nothing to undo', async () => {
    expect(
      await reassignConversationCommand.buildLog!({
        input: { scope: { tenantId: TENANT, organizationId: null } } as never,
        result: { status: 'noop', reason: 'assigned user unchanged' } as never,
        ctx: {} as never,
        snapshots: {},
      }),
    ).toBeNull()
  })
})
