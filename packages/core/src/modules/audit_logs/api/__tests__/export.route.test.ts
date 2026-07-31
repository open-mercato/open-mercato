/** @jest-environment node */
import { GET } from '@open-mercato/core/modules/audit_logs/api/audit-logs/actions/export/route'
import { actionLogListSchema } from '@open-mercato/core/modules/audit_logs/data/validators'

const mockRbac = { userHasAllFeatures: jest.fn() }
const mockActionLogs = { list: jest.fn() }
const mockEm = {}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => {
      if (token === 'rbacService') return mockRbac
      if (token === 'actionLogService') return mockActionLogs
      if (token === 'em') return mockEm
      return null
    },
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveFeatureCheckContext: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/audit_logs/api/audit-logs/display', () => ({
  loadAuditLogDisplayMaps: jest.fn(),
}))

function makeRequest(url: string) {
  return new Request(url, { method: 'GET' })
}

describe('GET /api/audit_logs/audit-logs/actions/export', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    const { resolveFeatureCheckContext } = await import('@open-mercato/core/modules/directory/utils/organizationScope')
    ;(resolveFeatureCheckContext as jest.Mock).mockResolvedValue({
      organizationId: 'org-1',
      scope: { allowedIds: null },
    })
    mockRbac.userHasAllFeatures.mockResolvedValue(false)
  })

  it('returns 401 when unauthenticated', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue(null)

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions/export'))
    expect(res.status).toBe(401)
  })

  it('returns 400 (not 500) when a filter fails uuid validation', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    const parsed = actionLogListSchema.safeParse({ actorUserId: 'not-a-uuid' })
    if (parsed.success) throw new Error('expected actionLogListSchema to reject a non-uuid actorUserId')
    mockActionLogs.list.mockRejectedValueOnce(parsed.error)

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions/export?actorUserId=not-a-uuid'))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('Validation failed')
  })

  // Regression for issue #3817 — the CSV export shares the read routes' scope handling, so
  // a tenant-less caller holding `audit_logs.view_tenant` could download every tenant's
  // decrypted action-log rows as a file.
  //
  // Null, omitted and empty-string tenant are all exercised: `.ai/lessons.md` (2026-07-11)
  // records that covering only explicit null misses the omitted-scope path.
  const tenantlessAuthContexts: Array<[string, Record<string, unknown>]> = [
    ['explicit null tenantId', { sub: 'user-1', tenantId: null, orgId: null }],
    ['omitted tenantId', { sub: 'user-1', orgId: null }],
    ['empty-string tenantId', { sub: 'user-1', tenantId: '', orgId: null }],
  ]

  describe.each(tenantlessAuthContexts)('tenant-less non-superadmin caller (%s)', (_label, authContext) => {
    it('is rejected with 403 before any rows are exported', async () => {
      const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
      ;(getAuthFromRequest as jest.Mock).mockResolvedValue(authContext)
      mockRbac.userHasAllFeatures.mockResolvedValue(true)

      const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions/export'))

      expect(res.status).toBe(403)
      expect(mockActionLogs.list).not.toHaveBeenCalled()
    })
  })

  it('preserves the intentional cross-tenant export for a tenant-less superadmin', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    const { loadAuditLogDisplayMaps } = await import('@open-mercato/core/modules/audit_logs/api/audit-logs/display')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: null,
      orgId: null,
      isSuperAdmin: true,
    })
    ;(loadAuditLogDisplayMaps as jest.Mock).mockResolvedValue({ users: {}, tenants: {}, organizations: {} })
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
    mockActionLogs.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 0 })

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions/export'))

    expect(res.status).toBe(200)
    expect(mockActionLogs.list).toHaveBeenCalledWith(expect.objectContaining({ tenantId: undefined }))
  })

  it('leaves a tenant-scoped caller tenant-filtered as before', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    const { loadAuditLogDisplayMaps } = await import('@open-mercato/core/modules/audit_logs/api/audit-logs/display')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    ;(loadAuditLogDisplayMaps as jest.Mock).mockResolvedValue({ users: {}, tenants: {}, organizations: {} })
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
    mockActionLogs.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 0 })

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions/export'))

    expect(res.status).toBe(200)
    expect(mockActionLogs.list).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-1' }))
  })
})
