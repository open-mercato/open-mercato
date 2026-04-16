/** @jest-environment node */
import { GET } from '@open-mercato/core/modules/audit_logs/api/audit-logs/actions/route'

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

const baseDate = new Date('2024-06-15T12:00:00.000Z')

function makeActionLogEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'action-1',
    commandId: 'cmd-1',
    actionLabel: 'Create Product',
    executionState: 'done',
    actorUserId: 'user-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    resourceKind: 'product',
    resourceId: 'prod-1',
    parentResourceKind: null,
    parentResourceId: null,
    undoToken: 'undo-token-1',
    createdAt: baseDate,
    updatedAt: baseDate,
    snapshotBefore: null,
    snapshotAfter: { name: 'Widget' },
    changesJson: { name: [null, 'Widget'] },
    contextJson: null,
    ...overrides,
  }
}

describe('GET /api/audit_logs/audit-logs/actions', () => {
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
    mockActionLogs.list.mockResolvedValue({
      items: [makeActionLogEntry()],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    })
  })

  it('returns 401 when unauthenticated', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue(null)

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions'))
    expect(res.status).toBe(401)
  })

  it('returns paginated response with default page=1 pageSize=50', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions'))
    expect(res.status).toBe(200)
    const data = await res.json()

    expect(data.page).toBe(1)
    expect(data.pageSize).toBe(50)
    expect(data.total).toBe(1)
    expect(data.totalPages).toBe(1)
    expect(data.items).toHaveLength(1)
    expect(data.items[0].actorUserName).toBe('Alice')
    expect(data.items[0].tenantName).toBe('Tenant')
    expect(data.items[0].organizationName).toBe('Org')
    expect(data.canViewTenant).toBe(false)
  })

  it('passes page and pageSize to service', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })

    mockActionLogs.list.mockResolvedValue({
      items: [],
      total: 120,
      page: 3,
      pageSize: 25,
      totalPages: 5,
    })

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions?page=3&pageSize=25'))
    expect(res.status).toBe(200)
    const data = await res.json()

    expect(data.page).toBe(3)
    expect(data.pageSize).toBe(25)
    expect(data.total).toBe(120)
    expect(data.totalPages).toBe(5)

    expect(mockActionLogs.list).toHaveBeenCalledWith(expect.objectContaining({
      page: 3,
      pageSize: 25,
    }))
  })

  it('clamps pageSize to max 200', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })

    await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions?pageSize=999'))
    expect(mockActionLogs.list).toHaveBeenCalledWith(expect.objectContaining({
      pageSize: 200,
    }))
  })

  it('scopes to actor when canViewTenant is false', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    mockRbac.userHasAllFeatures.mockResolvedValue(false)

    await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions'))
    expect(mockActionLogs.list).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'user-1',
    }))
  })

  it('widens scope when canViewTenant is true', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    mockRbac.userHasAllFeatures.mockResolvedValue(true)

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.canViewTenant).toBe(true)
    expect(mockActionLogs.list).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: undefined,
    }))
  })

  it('passes undoableOnly filter', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })

    await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions?undoableOnly=true'))
    expect(mockActionLogs.list).toHaveBeenCalledWith(expect.objectContaining({
      undoableOnly: true,
    }))
  })
})
