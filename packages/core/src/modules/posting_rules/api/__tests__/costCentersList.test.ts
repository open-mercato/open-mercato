/** @jest-environment node */
// `GET /api/posting_rules/cost-centers?isActive=...` must read the query
// token as a boolean (`?isActive=false` lists inactive cost centres), not
// coerce any non-empty string to `true`.
const ORG = '11111111-1111-4111-8111-111111111111'
const TENANT = '22222222-2222-4222-8222-222222222222'

const mockFindAndCount = jest.fn(async () => [[], 0])

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn(() => ({ POST: jest.fn(), PUT: jest.fn(), DELETE: jest.fn() })),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: jest.fn((token: string) => (token === 'em' ? { findAndCount: mockFindAndCount } : undefined)),
  })),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: 'user-1', tenantId: TENANT, orgId: ORG })),
}))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({ tenantId: TENANT, selectedId: ORG, filterIds: [ORG] })),
}))

import { GET } from '../cost-centers/route'

const list = (query: string) => GET(new Request(`http://localhost/api/posting_rules/cost-centers${query}`))
const lastFilter = () => (mockFindAndCount.mock.calls.at(-1) as unknown[] | undefined)?.[1] as Record<string, unknown>

describe('GET /api/posting_rules/cost-centers — isActive filter', () => {
  beforeEach(() => jest.clearAllMocks())

  it.each([
    ['false', false],
    ['0', false],
    ['true', true],
    ['1', true],
  ])('?isActive=%s filters isActive = %s', async (token, expected) => {
    const response = await list(`?isActive=${token}`)
    expect(response.status).toBe(200)
    expect(lastFilter().isActive).toBe(expected)
  })

  it('does not filter on isActive when the parameter is absent or empty', async () => {
    await list('')
    expect(lastFilter()).not.toHaveProperty('isActive')
    await list('?isActive=')
    expect(lastFilter()).not.toHaveProperty('isActive')
  })

  it('rejects a token that is not a boolean with 400', async () => {
    const response = await list('?isActive=maybe')
    expect(response.status).toBe(400)
    expect(mockFindAndCount).not.toHaveBeenCalled()
  })
})
