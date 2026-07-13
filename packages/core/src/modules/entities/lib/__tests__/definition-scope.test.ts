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
})
