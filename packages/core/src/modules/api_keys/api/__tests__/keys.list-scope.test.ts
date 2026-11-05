import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { resolveIsSuperAdmin } from '@open-mercato/core/modules/auth/lib/tenantAccess'
import '../keys/route'

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn((configuration) => ({ metadata: configuration.metadata })),
}))

jest.mock('@open-mercato/core/modules/auth/lib/tenantAccess', () => ({
  resolveIsSuperAdmin: jest.fn(),
  enforceTenantSelection: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (key: string) => key })),
}))

const tenantId = '123e4567-e89b-12d3-a456-426614174000'
const selectedOrganization = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const alternateOrganization = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const beforeList = jest.mocked(makeCrudRoute).mock.calls[0][0].hooks?.beforeList

function listFixture(organizationIds: string[] | null, allowedIds: string[] | null, authOrganization: string | null) {
  const queryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    getResultAndCount: jest.fn(async () => [[], 0]),
  }
  const createQueryBuilder = jest.fn(() => queryBuilder)
  const context = {
    auth: { sub: 'list-reader', tenantId, orgId: authOrganization },
    organizationIds,
    organizationScope: { allowedIds },
    container: { resolve: () => ({ createQueryBuilder }) },
  } as unknown as CrudCtx
  return { queryBuilder, createQueryBuilder, context }
}

describe('API-key list organization policy', () => {
  beforeEach(() => {
    jest.mocked(resolveIsSuperAdmin).mockResolvedValue(false)
  })

  it.each([
    { name: 'unrestricted actor', superadmin: false, allowedIds: null, tenantWide: true },
    { name: 'restricted actor', superadmin: false, allowedIds: [selectedOrganization], tenantWide: false },
    { name: 'superadmin with an allowlist', superadmin: true, allowedIds: [selectedOrganization], tenantWide: true },
    { name: 'superadmin without an allowlist', superadmin: true, allowedIds: null, tenantWide: true },
  ])('keeps tenant and search predicates separate for $name', async ({ superadmin, allowedIds, tenantWide }) => {
    jest.mocked(resolveIsSuperAdmin).mockResolvedValue(superadmin)
    const { queryBuilder, context } = listFixture([selectedOrganization], allowedIds, alternateOrganization)

    await expect(beforeList?.({ search: 'scope-marker', page: '2', pageSize: '1' }, context)).rejects.toBeInstanceOf(Response)

    expect(queryBuilder.where).toHaveBeenCalledWith({ deletedAt: null })
    expect(queryBuilder.andWhere.mock.calls.map(([condition]) => condition)).toEqual([
      { tenantId },
      tenantWide
        ? { $or: [{ organizationId: null }, { organizationId: { $in: [selectedOrganization] } }] }
        : { organizationId: { $in: [selectedOrganization] } },
      { $or: [{ name: { $ilike: '%scope-marker%' } }, { keyPrefix: { $ilike: '%scope-marker%' } }] },
    ])
    expect(queryBuilder.limit).toHaveBeenCalledWith(1)
    expect(queryBuilder.offset).toHaveBeenCalledWith(1)
  })

  it('uses the authenticated organization when no selected filter exists', async () => {
    const { queryBuilder, context } = listFixture(null, null, selectedOrganization)

    await expect(beforeList?.({}, context)).rejects.toBeInstanceOf(Response)

    expect(queryBuilder.andWhere).toHaveBeenCalledWith({
      $or: [{ organizationId: null }, { organizationId: selectedOrganization }],
    })
  })

  it('does not narrow a tenant-only request to an invented organization', async () => {
    const { queryBuilder, context } = listFixture(null, null, null)

    await expect(beforeList?.({}, context)).rejects.toBeInstanceOf(Response)

    expect(queryBuilder.andWhere.mock.calls).toEqual([[{ tenantId }]])
  })

  it('withholds tenant-wide keys when organization policy is unavailable', async () => {
    const { queryBuilder, context } = listFixture([selectedOrganization], null, selectedOrganization)
    context.organizationScope = null

    await expect(beforeList?.({}, context)).rejects.toBeInstanceOf(Response)

    expect(queryBuilder.andWhere.mock.calls).toEqual([
      [{ tenantId }],
      [{ organizationId: { $in: [selectedOrganization] } }],
    ])
  })

  it('returns an empty collection before querying for an empty resolved scope', async () => {
    const { createQueryBuilder, context } = listFixture([], [], selectedOrganization)
    jest.mocked(resolveIsSuperAdmin).mockResolvedValue(true)

    await expect(beforeList?.({}, context)).rejects.toBeInstanceOf(Response)

    expect(createQueryBuilder).not.toHaveBeenCalled()
  })
})
