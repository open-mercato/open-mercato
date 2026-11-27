/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const orgParentId = '20000000-2000-4000-8000-200000000000'
const orgAId = '22222222-2222-4222-8222-222222222222'
const orgBId = '33333333-3333-4333-8333-333333333333'
const orgChildOfBId = '44444444-4444-4444-8444-444444444444'
const userId = '55555555-5555-4555-8555-555555555555'

const em = {
  find: jest.fn(),
}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

const getAuthFromRequestMock = jest.fn()
const resolveOrganizationScopeForRequestMock = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequestMock(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    locale: 'en',
    translate: (_key: string, fallback?: string) => fallback ?? 'error',
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => resolveOrganizationScopeForRequestMock(...args),
}))

import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveDictionariesRouteContext } from '../context'

describe('resolveDictionariesRouteContext', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getAuthFromRequestMock.mockResolvedValue({
      sub: userId,
      tenantId,
      orgId: orgAId,
      isSuperAdmin: false,
    })
  })

  it('scopes readableOrganizationIds to only the selected organization and excludes sibling allowed orgs and auth.orgId', async () => {
    resolveOrganizationScopeForRequestMock.mockResolvedValue({
      tenantId,
      selectedId: orgBId,
      filterIds: [orgBId],
      allowedIds: [orgAId, orgBId],
    })
    em.find.mockResolvedValueOnce([{ id: orgBId, ancestorIds: [] }])

    const ctx = await resolveDictionariesRouteContext(new Request('http://localhost/api/dictionaries'))

    expect(ctx.organizationId).toBe(orgBId)
    expect(ctx.readableOrganizationIds).toEqual([orgBId])
    expect(em.find).toHaveBeenCalledWith(
      expect.anything(),
      { tenant: tenantId, deletedAt: null, id: { $in: [orgBId] } },
      { fields: ['id', 'ancestorIds'] },
    )
  })

  it('preserves downward inheritance from ancestor organizations without leaking sibling orgs', async () => {
    resolveOrganizationScopeForRequestMock.mockResolvedValue({
      tenantId,
      selectedId: orgBId,
      filterIds: [orgBId],
      allowedIds: [orgParentId, orgAId, orgBId],
    })
    em.find.mockResolvedValueOnce([{ id: orgBId, ancestorIds: [orgParentId] }])

    const ctx = await resolveDictionariesRouteContext(new Request('http://localhost/api/dictionaries'))

    expect(ctx.organizationId).toBe(orgBId)
    expect(ctx.readableOrganizationIds).toEqual([orgBId, orgParentId])
    expect(ctx.readableOrganizationIds).not.toContain(orgAId)
  })

  it('does not include descendant organizations from scope.filterIds when a parent organization is selected', async () => {
    resolveOrganizationScopeForRequestMock.mockResolvedValue({
      tenantId,
      selectedId: orgBId,
      filterIds: [orgBId, orgChildOfBId],
      allowedIds: [orgBId, orgChildOfBId],
    })
    em.find.mockResolvedValueOnce([{ id: orgBId, ancestorIds: [] }])

    const ctx = await resolveDictionariesRouteContext(new Request('http://localhost/api/dictionaries'))

    expect(ctx.organizationId).toBe(orgBId)
    expect(ctx.readableOrganizationIds).toEqual([orgBId])
    expect(em.find).toHaveBeenCalledWith(
      expect.anything(),
      { tenant: tenantId, deletedAt: null, id: { $in: [orgBId] } },
      { fields: ['id', 'ancestorIds'] },
    )
  })

  it('rejects requests whose organization selection was rejected', async () => {
    resolveOrganizationScopeForRequestMock.mockResolvedValue({
      tenantId,
      selectedId: orgAId,
      filterIds: [orgAId],
      allowedIds: [orgAId],
      selectionRejected: true,
    })

    await expect(
      resolveDictionariesRouteContext(new Request('http://localhost/api/dictionaries')),
    ).rejects.toMatchObject({ status: 403 } satisfies Partial<CrudHttpError>)
    expect(em.find).not.toHaveBeenCalled()
  })

  it('rejects requests with an explicitly empty organization scope', async () => {
    resolveOrganizationScopeForRequestMock.mockResolvedValue({
      tenantId,
      selectedId: null,
      filterIds: [],
      allowedIds: [],
    })

    await expect(
      resolveDictionariesRouteContext(new Request('http://localhost/api/dictionaries')),
    ).rejects.toMatchObject({ status: 403 } satisfies Partial<CrudHttpError>)
    expect(em.find).not.toHaveBeenCalled()
  })

  it('loads all active tenant organizations for an unrestricted all-organizations view', async () => {
    getAuthFromRequestMock.mockResolvedValue({
      sub: userId,
      tenantId,
      orgId: null,
      isSuperAdmin: true,
    })
    resolveOrganizationScopeForRequestMock.mockResolvedValue({
      tenantId,
      selectedId: null,
      filterIds: null,
      allowedIds: null,
    })
    em.find.mockResolvedValueOnce([
      { id: orgAId, ancestorIds: [] },
      { id: orgBId, ancestorIds: [] },
    ])

    const ctx = await resolveDictionariesRouteContext(new Request('http://localhost/api/dictionaries'))

    expect(ctx.organizationId).toBeNull()
    expect(ctx.readableOrganizationIds).toEqual([orgAId, orgBId])
    expect(em.find).toHaveBeenCalledWith(
      expect.anything(),
      { tenant: tenantId, deletedAt: null },
      { fields: ['id', 'ancestorIds'] },
    )
  })

  it('uses scope.filterIds when a restricted multi-org principal views all accessible organizations', async () => {
    resolveOrganizationScopeForRequestMock.mockResolvedValue({
      tenantId,
      selectedId: null,
      filterIds: [orgAId, orgBId],
      allowedIds: [orgAId, orgBId],
    })
    em.find.mockResolvedValueOnce([
      { id: orgAId, ancestorIds: [orgParentId] },
      { id: orgBId, ancestorIds: [orgParentId] },
    ])

    const ctx = await resolveDictionariesRouteContext(new Request('http://localhost/api/dictionaries'))

    expect(ctx.readableOrganizationIds).toEqual([orgAId, orgParentId, orgBId])
    expect(em.find).toHaveBeenCalledWith(
      expect.anything(),
      { tenant: tenantId, deletedAt: null, id: { $in: [orgAId, orgBId] } },
      { fields: ['id', 'ancestorIds'] },
    )
  })

  it('falls back to the home organization when an unrestricted principal omits an explicit org selection', async () => {
    getAuthFromRequestMock.mockResolvedValue({
      sub: userId,
      tenantId,
      orgId: orgAId,
      isSuperAdmin: true,
    })
    resolveOrganizationScopeForRequestMock.mockResolvedValue({
      tenantId,
      selectedId: null,
      filterIds: null,
      allowedIds: null,
    })
    em.find.mockResolvedValueOnce([{ id: orgAId, ancestorIds: [] }])

    const ctx = await resolveDictionariesRouteContext(new Request('http://localhost/api/dictionaries'))

    expect(ctx.organizationId).toBe(orgAId)
    expect(ctx.readableOrganizationIds).toEqual([orgAId])
    expect(em.find).toHaveBeenCalledWith(
      expect.anything(),
      { tenant: tenantId, deletedAt: null, id: { $in: [orgAId] } },
      { fields: ['id', 'ancestorIds'] },
    )
  })
})
