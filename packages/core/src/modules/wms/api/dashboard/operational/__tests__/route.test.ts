/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'

const resolveContainerService = jest.fn()
const container = { resolve: resolveContainerService }
const loadOperationalDashboardMock = jest.fn()
const resolveOrganizationScopeForRequestMock = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    sub: 'user-1',
    tenantId,
    orgId: organizationId,
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => resolveOrganizationScopeForRequestMock(...args),
}))

jest.mock('../../../../lib/loadOperationalDashboard', () => ({
  loadOperationalDashboard: (...args: unknown[]) => loadOperationalDashboardMock(...args),
  OperationalDashboardWarehouseNotFoundError: class OperationalDashboardWarehouseNotFoundError extends Error {},
}))

import { GET } from '../route'

describe('WMS operational dashboard organization scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resolveOrganizationScopeForRequestMock.mockResolvedValue({
      selectedId: organizationId,
      filterIds: [organizationId],
      allowedIds: [organizationId],
      tenantId,
    })
  })

  it('denies an explicit empty scope before resolving or calling the dashboard data layer', async () => {
    resolveOrganizationScopeForRequestMock.mockResolvedValue({
      selectedId: null,
      filterIds: [],
      allowedIds: [],
      tenantId,
    })

    const response = await GET(new Request('http://localhost/api/wms/dashboard/operational'))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(resolveContainerService).not.toHaveBeenCalled()
    expect(loadOperationalDashboardMock).not.toHaveBeenCalled()
  })
})
