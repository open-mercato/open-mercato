/** @jest-environment node */
import { POST } from '@open-mercato/core/modules/audit_logs/api/audit-logs/actions/undo/route'

const mockRbac = { userHasAllFeatures: jest.fn() }
const mockLogs = {
  findByUndoToken: jest.fn(),
  latestUndoableForResource: jest.fn(),
  latestUndoableForActor: jest.fn(),
}
const mockCommandBus = { undo: jest.fn() }

jest.mock('@/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => {
      if (token === 'rbacService') return mockRbac
      if (token === 'actionLogService') return mockLogs
      if (token === 'commandBus') return mockCommandBus
      return null
    },
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveFeatureCheckContext: jest.fn(),
  resolveOrganizationScopeForRequest: jest.fn(),
}))

function makeRequest(body: any) {
  return new Request('http://localhost/api/audit_logs/audit-logs/actions/undo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/audit_logs/audit-logs/actions/undo', () => {
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
    mockLogs.findByUndoToken.mockResolvedValue(null)
    mockLogs.latestUndoableForResource.mockResolvedValue(null)
    mockLogs.latestUndoableForActor.mockResolvedValue(null)
    mockCommandBus.undo.mockResolvedValue(undefined)
  })

  it('returns 401 when unauthenticated', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue(null)

    const res = await POST(makeRequest({ undoToken: 'tk' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when token missing', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: 'user-1' })

    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
  })

  it('undoes latest action and returns ok', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    const target = {
      id: 'log-1',
      actorUserId: 'user-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      resourceKind: 'auth.user',
      resourceId: 'user-42',
      executionState: 'done',
    }
    mockLogs.findByUndoToken.mockResolvedValue(target)
    mockLogs.latestUndoableForResource.mockResolvedValue(target)

    const res = await POST(makeRequest({ undoToken: 'token-1' }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, logId: 'log-1' })
    expect(mockCommandBus.undo).toHaveBeenCalledWith('token-1', expect.objectContaining({
      auth: expect.objectContaining({ sub: 'user-1' }),
      selectedOrganizationId: 'org-1',
    }))
  })
})
