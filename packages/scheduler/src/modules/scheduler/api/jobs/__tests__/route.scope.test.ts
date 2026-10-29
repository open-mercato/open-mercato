/** @jest-environment node */

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: async (_tenantId: string | null, fn: () => Promise<unknown>) => fn(),
}), { virtual: true })

const resolveContainerValue = jest.fn()
const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: resolveContainerValue }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: async () => ({
    sub: 'user-1',
    tenantId,
    orgId: organizationId,
    roles: ['admin'],
  }),
  getAuthFromCookies: async () => null,
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: async () => ({
    tenantId,
    selectedId: organizationId,
    filterIds: [],
    allowedIds: [],
  }),
}))

import { GET } from '../route'

describe('scheduler jobs route organization scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('denies the opt-out list before cache, query-engine, or entity-manager access', async () => {
    const response = await GET(new Request('http://localhost/api/scheduler/jobs?page=3&pageSize=20'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      items: [],
      total: 0,
      page: 3,
      pageSize: 20,
      totalPages: 0,
    })
    expect(resolveContainerValue).not.toHaveBeenCalled()
  })
})
