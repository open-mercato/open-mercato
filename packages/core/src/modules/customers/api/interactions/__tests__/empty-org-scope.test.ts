/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'

const getKysely = jest.fn(() => ({}))
const em = { fork: jest.fn(() => em), getKysely }
const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    throw new Error(`Unexpected service: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn(() => ({ POST: jest.fn(), PUT: jest.fn(), DELETE: jest.fn() })),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: 'user-1', tenantId, orgId: organizationId })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({
    selectedId: null,
    filterIds: [],
    allowedIds: [],
    tenantId,
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

import { GET } from '../route'

describe('interaction list organization scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns no rows for empty scope instead of querying auth.orgId', async () => {
    const response = await GET(new Request('http://localhost/api/customers/interactions'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ items: [] })
    expect(container.resolve).not.toHaveBeenCalled()
    expect(getKysely).not.toHaveBeenCalled()
  })
})
