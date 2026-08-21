/** @jest-environment node */
import { GET } from '@open-mercato/core/modules/audit_logs/api/audit-logs/access/export/route'

const mockRbac = { userHasAllFeatures: jest.fn() }
const mockAccess = { list: jest.fn() }
const mockEm = {}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
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

function request(url = 'http://localhost/api/audit_logs/audit-logs/access/export') {
  return new Request(url, { method: 'GET' })
}

describe('GET /api/audit_logs/audit-logs/access/export', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    const { resolveFeatureCheckContext } = await import('@open-mercato/core/modules/directory/utils/organizationScope')
    ;(resolveFeatureCheckContext as jest.Mock).mockResolvedValue({
      organizationId: '33333333-3333-4333-8333-333333333333',
      scope: { allowedIds: null },
    })
    const { loadAuditLogDisplayMaps } = await import('@open-mercato/core/modules/audit_logs/api/audit-logs/display')
    ;(loadAuditLogDisplayMaps as jest.Mock).mockResolvedValue({
      users: { '11111111-1111-4111-8111-111111111111': 'Alice' },
      tenants: { '22222222-2222-4222-8222-222222222222': 'Tenant' },
      organizations: { '33333333-3333-4333-8333-333333333333': 'Organization' },
    })
    mockRbac.userHasAllFeatures.mockResolvedValue(false)
    mockAccess.list.mockResolvedValue({
      items: [{
        id: 'log-1',
        tenantId: '22222222-2222-4222-8222-222222222222',
        organizationId: '33333333-3333-4333-8333-333333333333',
        actorUserId: '11111111-1111-4111-8111-111111111111',
        resourceKind: 'customers.person',
        resourceId: 'person-1',
        accessType: 'read:item',
        fieldsJson: ['id', 'email'],
        contextJson: {
          method: 'GET',
          operation: 'read:item',
          path: '/api/customers/people',
          requestId: 'request-1',
          result: 'success',
          sessionId: 'session-1',
          sourceIp: '203.0.113.5',
          statusCode: 200,
          userAgent: 'Browser',
        },
        createdAt: new Date('2026-08-21T10:00:00.000Z'),
      }],
      total: 1,
      page: 1,
      pageSize: 200,
      totalPages: 1,
    })
  })

  it('requires authentication', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue(null)

    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(mockAccess.list).not.toHaveBeenCalled()
  })

  it('exports normalized access fields within the authenticated scope', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: '11111111-1111-4111-8111-111111111111',
      tenantId: '22222222-2222-4222-8222-222222222222',
      orgId: '33333333-3333-4333-8333-333333333333',
    })

    const response = await GET(request())
    const csv = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/csv')
    expect(csv).toContain('Source IP')
    expect(csv).toContain('203.0.113.5')
    expect(csv).toContain('request-1')
    expect(csv).toContain('customers.person')
    expect(mockAccess.list).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: '11111111-1111-4111-8111-111111111111',
      organizationId: '33333333-3333-4333-8333-333333333333',
      tenantId: '22222222-2222-4222-8222-222222222222',
    }))
  })

  it('rejects a tenant-less non-superadmin before reading rows', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: '11111111-1111-4111-8111-111111111111',
      tenantId: null,
      orgId: null,
    })
    mockRbac.userHasAllFeatures.mockResolvedValue(true)

    const response = await GET(request())

    expect(response.status).toBe(403)
    expect(mockAccess.list).not.toHaveBeenCalled()
  })

  it('only accepts actor overrides for tenant viewers', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: '11111111-1111-4111-8111-111111111111',
      tenantId: '22222222-2222-4222-8222-222222222222',
      orgId: '33333333-3333-4333-8333-333333333333',
    })
    mockRbac.userHasAllFeatures.mockResolvedValue(true)

    await GET(request('http://localhost/api/audit_logs/audit-logs/access/export?actorUserId=44444444-4444-4444-8444-444444444444'))

    expect(mockAccess.list).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: '44444444-4444-4444-8444-444444444444',
      tenantId: '22222222-2222-4222-8222-222222222222',
    }))
  })
})
