/** @jest-environment node */
import { POST } from '@open-mercato/core/modules/audit_logs/api/audit-logs/actions/undo/route'

const mockRbac = { userHasAllFeatures: jest.fn() }
const mockLogs = {
  findByUndoToken: jest.fn(),
  latestUndoableForResource: jest.fn(),
  latestUndoableForActor: jest.fn(),
}
const mockCommandBus = { undo: jest.fn() }

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
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

  // Regression for issue #2398 — org create/update/delete/reparent log rows are
  // tenant-level (organization_id = NULL). A super-admin resolves to a concrete
  // home org, so the old code re-looked-up the latest undoable action with that
  // home org and never matched the null-org row, returning 400. The lookup must
  // be scoped to the target row's own organization instead of the caller's.
  it('undoes a tenant-level org action when the caller resolves to a different home org', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    const { resolveFeatureCheckContext } = await import('@open-mercato/core/modules/directory/utils/organizationScope')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'admin-1',
      tenantId: 'tenant-1',
      orgId: 'org-home',
      isSuperAdmin: true,
    })
    // Super-admin browsing the global directory resolves to their home org.
    ;(resolveFeatureCheckContext as jest.Mock).mockResolvedValue({
      organizationId: 'org-home',
      scope: { allowedIds: null },
    })
    // Super-admin has audit_logs.undo_tenant via the wildcard grant.
    mockRbac.userHasAllFeatures.mockResolvedValue(true)

    const target = {
      id: 'log-org-1',
      actorUserId: 'admin-1',
      tenantId: 'tenant-1',
      organizationId: null,
      resourceKind: 'directory.organization',
      resourceId: 'new-org-1',
      executionState: 'done',
    }
    mockLogs.findByUndoToken.mockResolvedValue(target)
    // Mirror the DB filter: the row is only returned when the lookup is NOT
    // over-scoped to a concrete org it does not belong to.
    mockLogs.latestUndoableForResource.mockImplementation(
      async ({ organizationId }: { organizationId: string | null }) =>
        organizationId == null ? target : null,
    )
    mockLogs.latestUndoableForActor.mockImplementation(
      async (_actorUserId: string, { organizationId }: { organizationId: string | null }) =>
        organizationId == null ? target : null,
    )

    const res = await POST(makeRequest({ undoToken: 'token-org-1' }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, logId: 'log-org-1' })
    expect(mockLogs.latestUndoableForResource).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: null, resourceId: 'new-org-1' }),
    )
    expect(mockCommandBus.undo).toHaveBeenCalledWith('token-org-1', expect.anything())
  })

  // Regression for issue #2685 — a caller with a null tenantId (tenant-less global
  // account or unscoped API key) must NOT undo a tenant-scoped row. The old guard
  // (`target.tenantId && auth.tenantId && ...`) short-circuited to "allow" whenever
  // auth.tenantId was null, leaking cross-tenant undo.
  it('rejects a tenant-less caller undoing a tenant-scoped row', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: null,
      orgId: null,
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
    mockLogs.latestUndoableForActor.mockResolvedValue(target)

    const res = await POST(makeRequest({ undoToken: 'token-1' }))
    expect(res.status).toBe(400)
    expect(mockCommandBus.undo).not.toHaveBeenCalled()
  })

  // Regression for issue #2685 — a regular caller (no audit_logs.undo_tenant) whose
  // organization scope resolves to null must NOT undo an org-scoped row. The old org
  // guard (`target.organizationId && scopedOrgId && ...`) skipped rejection when
  // scopedOrgId was null; only tenant-level undoers may legitimately leave org null.
  it('rejects a regular caller with null org scope undoing an org-scoped row', async () => {
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

    const target = {
      id: 'log-2',
      actorUserId: 'user-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      resourceKind: 'auth.user',
      resourceId: 'user-42',
      executionState: 'done',
    }
    mockLogs.findByUndoToken.mockResolvedValue(target)
    mockLogs.latestUndoableForResource.mockResolvedValue(target)
    mockLogs.latestUndoableForActor.mockResolvedValue(target)

    const res = await POST(makeRequest({ undoToken: 'token-2' }))
    expect(res.status).toBe(400)
    expect(mockCommandBus.undo).not.toHaveBeenCalled()
  })
})
