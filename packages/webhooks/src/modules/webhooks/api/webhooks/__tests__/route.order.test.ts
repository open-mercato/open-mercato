/** @jest-environment node */

type BeforeList = (
  query: { page: string; pageSize: string },
  ctx: { auth: { tenantId: string; orgId: string }; container: { resolve: jest.Mock } },
) => Promise<void>

const captured: { beforeList?: BeforeList } = {}

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn((options: { hooks: { beforeList: BeforeList } }) => {
    captured.beforeList = options.hooks.beforeList
    return { metadata: {}, GET: jest.fn(), POST: jest.fn(), PUT: jest.fn(), DELETE: jest.fn() }
  }),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

import '../route'

describe('webhook list ordering', () => {
  it('breaks creation timestamp ties by id when paginating', async () => {
    const qb = {
      where: jest.fn(),
      andWhere: jest.fn(),
      orderBy: jest.fn(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn(),
      getResultAndCount: jest.fn(async () => [[], 0]),
    }
    const beforeList = captured.beforeList
    if (!beforeList) throw new Error('Expected the webhook list hook to be registered')

    await expect(beforeList({ page: '2', pageSize: '10' }, {
      auth: { tenantId: 'tenant-1', orgId: 'org-1' },
      container: { resolve: jest.fn(() => ({ createQueryBuilder: jest.fn(() => qb) })) },
    })).rejects.toMatchObject({ status: 200 })

    expect(qb.orderBy).toHaveBeenCalledWith({ createdAt: 'desc', id: 'desc' })
    expect(qb.limit).toHaveBeenCalledWith(10)
    expect(qb.offset).toHaveBeenCalledWith(10)
  })
})
