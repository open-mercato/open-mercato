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
    filterIds: null,
    allowedIds: null,
  }),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback: string) => fallback,
  }),
}))

import { GET } from '../route'

type QueryBuilderMock = {
  where: jest.Mock
  andWhere: jest.Mock
  orderBy: jest.Mock
  limit: jest.Mock
  offset: jest.Mock
  getResultAndCount: jest.Mock
}

function makeQueryBuilder(): QueryBuilderMock {
  const qb: QueryBuilderMock = {
    where: jest.fn(() => qb),
    andWhere: jest.fn(() => qb),
    orderBy: jest.fn(() => qb),
    limit: jest.fn(() => qb),
    offset: jest.fn(() => qb),
    getResultAndCount: jest.fn(async () => [[], 0]),
  }
  return qb
}

describe('webhook delivery list ordering', () => {
  it('breaks createdAt ties by id so offset pages stay stable', async () => {
    const qb = makeQueryBuilder()
    resolveContainerValue.mockImplementation((key: string) => {
      if (key === 'em') return { createQueryBuilder: jest.fn(() => qb) }
      throw new Error(`[internal] unexpected resolve(${key})`)
    })

    const response = await GET(new Request('http://localhost/api/webhook-deliveries?page=2&pageSize=25'))

    expect(response.status).toBe(200)
    expect(qb.orderBy).toHaveBeenCalledTimes(1)
    expect(qb.orderBy).toHaveBeenCalledWith({ createdAt: 'desc', id: 'desc' })
    expect(qb.limit).toHaveBeenCalledWith(25)
    expect(qb.offset).toHaveBeenCalledWith(25)
  })
})
