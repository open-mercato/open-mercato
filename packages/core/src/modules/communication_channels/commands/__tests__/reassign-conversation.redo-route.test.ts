/** @jest-environment node */

const mockFindOne = jest.fn()
const mockGetAuth = jest.fn()
const mockFlush = jest.fn(async () => undefined)
const mockRbac = { userHasAllFeatures: jest.fn(), loadAcl: jest.fn() }
const mockLogs = { findById: jest.fn(), latestUndoneForActor: jest.fn(), markRedone: jest.fn() }
const mockCommandBus = { execute: jest.fn() }

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOne(...args),
  findWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuth(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => {
      if (token === 'rbacService') return mockRbac
      if (token === 'actionLogService') return mockLogs
      if (token === 'commandBus') return mockCommandBus
      if (token === 'em') return { fork: () => ({ flush: mockFlush }) }
      return null
    },
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveFeatureCheckContext: jest.fn(async () => ({
    organizationId: '77777777-7777-4777-8777-777777777777',
    scope: { allowedIds: null },
  })),
  resolveOrganizationScopeForRequest: jest.fn(async () => ({
    selectedId: '77777777-7777-4777-8777-777777777777',
    filterIds: ['77777777-7777-4777-8777-777777777777'],
    allowedIds: null,
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback: string) => fallback,
  }),
}))

import { POST as redoRoute } from '@open-mercato/core/modules/audit_logs/api/audit-logs/actions/redo/route'
import reassignConversationCommand from '../reassign-conversation'

const TENANT = '22222222-2222-4222-8222-222222222222'
const ORG = '77777777-7777-4777-8777-777777777777'
const THREAD = '11111111-1111-4111-8111-111111111111'
const ASSIGNEE = '33333333-3333-4333-8333-333333333333'
const OWNER = '55555555-5555-4555-8555-555555555555'
const OTHER_ADMIN = '66666666-6666-4666-8666-666666666666'

const undoneLog = {
  id: 'log-undone',
  commandId: 'communication_channels.conversation.reassign',
  actorUserId: OWNER,
  tenantId: TENANT,
  organizationId: ORG,
  executionState: 'undone',
  commandPayload: {
    __redoInput: {
      threadId: THREAD,
      assignedUserId: ASSIGNEE,
      scope: { tenantId: TENANT, organizationId: ORG },
    },
  },
}

function seedPersonalMailboxLookups(options: { granted: boolean }): void {
  mockFindOne
    .mockResolvedValueOnce({ id: 'mapping-1', assignedUserId: null, externalConversationId: 'conv-1', channelId: 'channel-1', tenantId: TENANT })
    .mockResolvedValueOnce({ id: 'channel-1', userId: OWNER })
  if (options.granted) {
    mockFindOne
      .mockResolvedValueOnce({ id: ASSIGNEE })
      .mockResolvedValueOnce({ id: 'conv-1', assignedUserId: null })
  }
}

function redoRequest(): Request {
  return new Request('http://localhost/api/audit_logs/audit-logs/actions/redo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ logId: undoneLog.id }),
  })
}

describe('audit_logs redo of a personal-mailbox reassignment (#3832)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindOne.mockReset()
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
    mockLogs.findById.mockResolvedValue(undoneLog)
    mockLogs.latestUndoneForActor.mockResolvedValue(undoneLog)
    mockLogs.markRedone.mockResolvedValue(undefined)
    mockCommandBus.execute.mockImplementation(
      async (_commandId: string, options: { input: never; ctx: never; redoLogEntry: never }) => {
        const result = await reassignConversationCommand.redo!({
          input: options.input,
          ctx: options.ctx,
          logEntry: options.redoLogEntry,
        })
        return { result, logEntry: { id: 'log-redo', undoToken: 'redo-token', createdAt: new Date() } }
      },
    )
  })

  it('refuses a non-owner tenant redoer with a masked 404 and leaves the log undone', async () => {
    mockGetAuth.mockResolvedValue({ sub: OTHER_ADMIN, tenantId: TENANT, orgId: ORG })
    seedPersonalMailboxLookups({ granted: false })

    const res = await redoRoute(redoRequest())

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'Thread not found' })
    expect(mockLogs.markRedone).not.toHaveBeenCalled()
    expect(mockFlush).not.toHaveBeenCalled()
  })

  it('lets the mailbox owner retry the same redo after a denied attempt', async () => {
    mockGetAuth.mockResolvedValueOnce({ sub: OTHER_ADMIN, tenantId: TENANT, orgId: ORG })
    seedPersonalMailboxLookups({ granted: false })
    expect((await redoRoute(redoRequest())).status).toBe(404)

    mockGetAuth.mockResolvedValueOnce({ sub: OWNER, tenantId: TENANT, orgId: ORG })
    seedPersonalMailboxLookups({ granted: true })
    const res = await redoRoute(redoRequest())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ ok: true, logId: 'log-redo', undoToken: 'redo-token' })
    expect(mockLogs.markRedone).toHaveBeenCalledTimes(1)
    expect(mockLogs.markRedone).toHaveBeenCalledWith(undoneLog.id)
    expect(mockFlush).toHaveBeenCalledTimes(1)
  })
})
