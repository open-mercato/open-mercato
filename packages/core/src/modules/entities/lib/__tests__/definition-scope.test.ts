import { resolveDefinitionScopeFromOrganizationScope } from '../definition-scope'

describe('definition scope resolution', () => {
  it('keeps an org-bound user in their auth tenant when the organization resolver returns another tenant', () => {
    expect(resolveDefinitionScopeFromOrganizationScope(
      { tenantId: 'auth-tenant', orgId: 'auth-org' },
      { tenantId: 'selected-tenant', selectedId: 'selected-org' },
    )).toEqual({
      tenantId: 'auth-tenant',
      organizationId: 'auth-org',
    })
  })

  it('uses the resolved organization when it belongs to the same tenant', () => {
    expect(resolveDefinitionScopeFromOrganizationScope(
      { tenantId: 'tenant-1', orgId: 'org-1' },
      { tenantId: 'tenant-1', selectedId: 'org-2' },
    )).toEqual({
      tenantId: 'tenant-1',
      organizationId: 'org-2',
    })
  })

  it('allows selected tenant scope when auth has no tenant context', () => {
    expect(resolveDefinitionScopeFromOrganizationScope(
      { tenantId: null, orgId: null },
      { tenantId: 'selected-tenant', selectedId: 'selected-org' },
    )).toEqual({
      tenantId: 'selected-tenant',
      organizationId: 'selected-org',
    })
  })

  it.each([
    [{ filterIds: [], allowedIds: ['org-1'] }],
    [{ filterIds: null, allowedIds: [] }],
  ])('denies runtime finite empty arrays before the home-organization fallback', (finiteScope) => {
    expect(() => resolveDefinitionScopeFromOrganizationScope(
      { tenantId: 'tenant-1', orgId: 'org-1' },
      { tenantId: 'tenant-1', selectedId: 'org-1', ...finiteScope },
    )).toThrow(expect.objectContaining({ status: 403, body: { error: 'Forbidden' } }))
  })

  it.each([
    [{ tenantId: 'tenant-1', selectedId: null, filterIds: null, allowedIds: null }],
    [{ tenantId: 'tenant-1', selectedId: null }],
  ])('preserves the home-organization fallback for null or absent finite scope', (scope) => {
    expect(resolveDefinitionScopeFromOrganizationScope(
      { tenantId: 'tenant-1', orgId: 'org-1' },
      scope,
    )).toEqual({ tenantId: 'tenant-1', organizationId: 'org-1' })
  })
})
