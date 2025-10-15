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

jest.mock('@/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@/lib/di/container', () => ({
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
    const { getAuthFromRequest } = await import('@/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue(null)

    const res = await POST(makeRequest({ logId: 'log-1' }))
    expect(res.status).toBe(401)
  })

  it('replays latest undone log and returns undo metadata', async () => {
    const { getAuthFromRequest } = await import('@/lib/auth/server')
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
})
