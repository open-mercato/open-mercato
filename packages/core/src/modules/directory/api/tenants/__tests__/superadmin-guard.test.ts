/** @jest-environment node */

const actorTenantId = '11111111-1111-4111-8111-111111111111'

const em = {
  find: jest.fn(),
  findOne: jest.fn(),
  findAndCount: jest.fn(),
} as { find: jest.Mock; findOne: jest.Mock; findAndCount: jest.Mock }

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'rbacService') return { loadAcl: jest.fn(async () => ({ isSuperAdmin: false })) }
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

const getAuthFromRequest = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequest(...(args as [])),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  buildCustomFieldFiltersFromQuery: jest.fn(async () => ({})),
  loadCustomFieldValues: jest.fn(async () => ({})),
}))

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: () => ({ metadata: {}, GET: jest.fn(), POST: jest.fn(), PUT: jest.fn(), DELETE: jest.fn() }),
  logCrudAccess: jest.fn(async () => {}),
}))

import { GET } from '../route'

describe('GET /api/directory/tenants superadmin guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('denies GET to a non-superadmin', async () => {
    getAuthFromRequest.mockResolvedValue({ sub: 'user-a', tenantId: actorTenantId, orgId: null, isSuperAdmin: false })

    const res = await GET(new Request('http://localhost/api/directory/tenants'))

    expect(res.status).toBe(403)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toBe('Forbidden')
    expect(em.findAndCount).not.toHaveBeenCalled()
  })

  it('allows GET to a superadmin', async () => {
    getAuthFromRequest.mockResolvedValue({ sub: 'super-1', tenantId: actorTenantId, orgId: null, isSuperAdmin: true })
    em.findAndCount.mockResolvedValue([[], 0])

    const res = await GET(new Request('http://localhost/api/directory/tenants'))

    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; total: number }
    expect(body.items).toEqual([])
    expect(body.total).toBe(0)
    expect(em.findAndCount).toHaveBeenCalledTimes(1)
  })
})
