/** @jest-environment node */
import { POST } from '@open-mercato/core/modules/audit_logs/api/audit-logs/actions/redo/route'

const mockRbac = { userHasAllFeatures: jest.fn() }
const mockLogs = {
  findById: jest.fn(),
  latestUndoneForActor: jest.fn(),
  markRedone: jest.fn(),
}
const mockCommandBus = {
  execute: jest.fn(),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => {
      if (token === 'rbacService') return mockRbac
      if (token === 'actionLogService') return mockLogs
      if (token === 'commandBus') return mockCommandBus
      if (token === 'em') return {}
      return null
    },
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveFeatureCheckContext: jest.fn(),
  resolveOrganizationScopeForRequest: jest.fn(),
}))

function makeRequest(body: any) {
  return new Request('http://localhost/api/audit_logs/audit-logs/actions/redo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/audit_logs/audit-logs/actions/redo', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    const { resolveFeatureCheckContext, resolveOrganizationScopeForRequest } = await import('@open-mercato/core/modules/directory/utils/organizationScope')
    ;(resolveFeatureCheckContext as jest.Mock).mockResolvedValue({
      organizationId: 'org-1',
      scope: { allowedIds: null },
    })
    ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({
      selectedId: 'org-1',
      filterIds: ['org-1'],
      allowedIds: null,
    })
    mockRbac.userHasAllFeatures.mockResolvedValue(false)
    mockLogs.findById.mockResolvedValue(null)
    mockLogs.latestUndoneForActor.mockResolvedValue(null)
    mockLogs.markRedone.mockResolvedValue(undefined)
    mockCommandBus.execute.mockResolvedValue({ logEntry: null })
  })

  it('returns 401 when unauthenticated', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue(null)

    const res = await POST(makeRequest({ logId: 'log-1' }))
    expect(res.status).toBe(401)
  })

  it('replays latest undone log and returns undo metadata', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    const log = {
      id: 'log-undo',
      commandId: 'demo.command',
      actionLabel: 'Demo action',
      resourceKind: 'demo.resource',
      resourceId: 'res-1',
      executionState: 'undone',
      actorUserId: 'user-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      commandPayload: { __redoInput: { foo: 'bar' } },
      contextJson: { cacheAliases: ['demo.resource:res-1'] },
    }
    const newLog = {
      id: 'log-redo',
      undoToken: 'undo-new',
      commandId: 'demo.command',
      actionLabel: 'Redo action',
      resourceKind: 'demo.resource',
      resourceId: 'res-1',
      createdAt: new Date('2024-01-02T00:00:00.000Z'),
    }
    mockLogs.findById.mockResolvedValue(log)
    mockLogs.latestUndoneForActor.mockResolvedValue(log)
    mockCommandBus.execute.mockResolvedValue({ logEntry: newLog })

    const res = await POST(makeRequest({ logId: 'log-undo' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ ok: true, logId: 'log-redo', undoToken: 'undo-new' })
    expect(mockCommandBus.execute).toHaveBeenCalledWith('demo.command', expect.objectContaining({
      input: { foo: 'bar' },
      metadata: expect.objectContaining({
        actionLabel: 'Demo action',
        resourceId: 'res-1',
        context: expect.objectContaining({
          historyAction: 'redo',
          sourceLogId: 'log-undo',
          sourceCommandId: 'demo.command',
          cacheAliases: ['demo.resource:res-1'],
        }),
      }),
    }))
    const opHeader = res.headers.get('x-om-operation')
    expect(opHeader).toBe(
      'omop:' +
        encodeURIComponent(
          JSON.stringify({
            id: 'log-redo',
            undoToken: 'undo-new',
            commandId: 'demo.command',
            actionLabel: 'Redo action',
            resourceKind: 'demo.resource',
            resourceId: 'res-1',
            executedAt: '2024-01-02T00:00:00.000Z',
          }),
        ),
    )
    expect(mockLogs.markRedone).toHaveBeenCalledWith('log-undo')
  })

  it('uses tenant-level latest-undone scope for logs without organization id', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    const log = {
      id: 'log-tenant',
      commandId: 'directory.organizations.create',
      actionLabel: 'Create organization',
      resourceKind: 'directory.organization',
      resourceId: 'org-created',
      executionState: 'undone',
      actorUserId: 'user-1',
      tenantId: 'tenant-1',
      organizationId: null,
      commandPayload: { __redoInput: {} },
      contextJson: null,
    }
    mockLogs.findById.mockResolvedValue(log)
    mockLogs.latestUndoneForActor.mockResolvedValue(log)

    const res = await POST(makeRequest({ logId: 'log-tenant' }))

    expect(res.status).toBe(200)
    expect(mockLogs.latestUndoneForActor).toHaveBeenCalledWith('user-1', {
      tenantId: 'tenant-1',
      organizationId: null,
    })
  })

  // Regression for issue #2931 — a caller with a null tenantId (tenant-less global
  // account or unscoped API key) must NOT redo a tenant-scoped row. The old guard
  // (`log.tenantId && auth.tenantId && ...`) short-circuited to "allow" whenever
  // auth.tenantId was null, mirroring the pre-#2685 undo defect.
  it('rejects a tenant-less caller redoing a tenant-scoped row', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: null,
      orgId: null,
    })
    const log = {
      id: 'log-1',
      commandId: 'demo.command',
      actorUserId: 'user-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      resourceKind: 'auth.user',
      resourceId: 'user-42',
      executionState: 'undone',
      commandPayload: { __redoInput: {} },
      contextJson: null,
    }
    mockLogs.findById.mockResolvedValue(log)
    mockLogs.latestUndoneForActor.mockResolvedValue(log)

    const res = await POST(makeRequest({ logId: 'log-1' }))
    expect(res.status).toBe(400)
    expect(mockCommandBus.execute).not.toHaveBeenCalled()
  })

  // Regression for issue #2931 — a regular caller (no audit_logs.redo_tenant) whose
  // organization scope resolves to null must NOT redo an org-scoped row. The old org
  // guard (`log.organizationId && scopedOrgId && ...`) skipped rejection when
  // scopedOrgId was null; only tenant-level redoers may legitimately leave org null.
  it('rejects a regular caller with null org scope redoing an org-scoped row', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    const { resolveFeatureCheckContext } = await import('@open-mercato/core/modules/directory/utils/organizationScope')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: null,
    })
    ;(resolveFeatureCheckContext as jest.Mock).mockResolvedValue({
      organizationId: null,
      scope: { allowedIds: null },
    })
    mockRbac.userHasAllFeatures.mockResolvedValue(false)

    const log = {
      id: 'log-2',
      commandId: 'demo.command',
      actorUserId: 'user-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      resourceKind: 'auth.user',
      resourceId: 'user-42',
      executionState: 'undone',
      commandPayload: { __redoInput: {} },
      contextJson: null,
    }
    mockLogs.findById.mockResolvedValue(log)
    mockLogs.latestUndoneForActor.mockResolvedValue(log)

    const res = await POST(makeRequest({ logId: 'log-2' }))
    expect(res.status).toBe(400)
    expect(mockCommandBus.execute).not.toHaveBeenCalled()
  })
})
