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
})
