/**
 * Route-level tenant/org scoping test (task 6.1 DoD: "aggregation tests
 * WITH tenant scoping assertions"). Mocks `em` so we can assert the exact
 * filter object `em.find` receives includes `tenantId` and
 * `organizationId`, not just that the response looks right.
 */

import { NextRequest } from 'next/server'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { GET } from '../route'

const TENANT_ID = 'tenant-1'
const ORG_ID = 'org-1'

describe('GET /api/production/analytics/late-orders scoping', () => {
  let findMock: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    findMock = jest.fn().mockResolvedValue([])
    const em = { fork: jest.fn().mockReturnThis(), find: findMock }
    const container = { resolve: jest.fn().mockReturnValue(em) }
    ;(createRequestContainer as jest.Mock).mockResolvedValue(container)
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID })
    ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({
      selectedId: ORG_ID,
      filterIds: [ORG_ID],
    })
  })

  it('scopes the ProductionOrder query by tenantId and organizationId', async () => {
    const req = new NextRequest('http://localhost/api/production/analytics/late-orders')
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(findMock).toHaveBeenCalledTimes(1)
    const [, where] = findMock.mock.calls[0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.organizationId).toEqual({ $in: [ORG_ID] })
    expect(where.status).toEqual({ $in: ['released', 'in_progress'] })
  })

  it('never queries across tenants: a different tenant only sees its own filter value', async () => {
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: 'user-2', tenantId: 'tenant-2', orgId: 'org-2' })
    ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({
      selectedId: 'org-2',
      filterIds: ['org-2'],
    })
    const req = new NextRequest('http://localhost/api/production/analytics/late-orders')
    await GET(req)
    const [, where] = findMock.mock.calls[0]
    expect(where.tenantId).toBe('tenant-2')
    expect(where.organizationId).toEqual({ $in: ['org-2'] })
  })
})
