/** @jest-environment node */
import { GET } from '@open-mercato/core/modules/audit_logs/api/audit-logs/access/route'

const mockRbac = { userHasAllFeatures: jest.fn() }
const mockAccess = { list: jest.fn() }
const mockEm = {}

jest.mock('@/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => {
      if (token === 'rbacService') return mockRbac
      if (token === 'accessLogService') return mockAccess
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

describe('GET /api/audit_logs/audit-logs/access', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    const { resolveFeatureCheckContext } = await import('@open-mercato/core/modules/directory/utils/organizationScope')
    ;(resolveFeatureCheckContext as jest.Mock).mockResolvedValue({
      organizationId: 'org-1',
      scope: { allowedIds: null },
    })
    const { loadAuditLogDisplayMaps } = await import('@open-mercato/core/modules/audit_logs/api/audit-logs/display')
    ;(loadAuditLogDisplayMaps as jest.Mock).mockResolvedValue({
      users: { 'user-1': 'Alice' },
      tenants: { 'tenant-1': 'Tenant' },
      organizations: { 'org-1': 'Org' },
    })
    mockRbac.userHasAllFeatures.mockResolvedValue(false)
    mockAccess.list.mockResolvedValue({
      items: [
        {
          id: 'log-1',
          resourceKind: 'auth.user',
          resourceId: 'user-42',
          accessType: 'view',
          actorUserId: 'user-1',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          fieldsJson: ['email'],
          contextJson: { ip: '127.0.0.1' },
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    })
  })

  it('returns 401 when unauthenticated', async () => {
    const { getAuthFromRequest } = await import('@/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue(null)

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/access'))
    expect(res.status).toBe(401)
  })

  it('returns list payload when authenticated', async () => {
    const { getAuthFromRequest } = await import('@/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/access?page=2&pageSize=25'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.page).toBe(1)
    expect(data.items).toEqual([
      {
        id: 'log-1',
        resourceKind: 'auth.user',
        resourceId: 'user-42',
        accessType: 'view',
        actorUserId: 'user-1',
        actorUserName: 'Alice',
        tenantId: 'tenant-1',
        tenantName: 'Tenant',
        organizationId: 'org-1',
        organizationName: 'Org',
        fields: ['email'],
        context: { ip: '127.0.0.1' },
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ])
    expect(data.canViewTenant).toBe(false)
    expect(mockAccess.list).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      actorUserId: 'user-1',
      page: 2,
      pageSize: 25,
    }))
  })
})
