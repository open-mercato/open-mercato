import { resolveOrganizationScopeFilter } from '../organizationScopeFilter'

describe('resolveOrganizationScopeFilter', () => {
  it('prefers scope.selectedId when present', () => {
    const result = resolveOrganizationScopeFilter(
      { selectedId: 'org-selected', filterIds: ['org-a', 'org-b'], allowedIds: null, tenantId: 't1' },
      { orgId: 'org-auth' },
    )

    expect(result.organizationIds).toEqual(['org-selected'])
    expect(result.where).toEqual({ organizationId: { $in: ['org-selected'] } })
    expect(result.rbacOrganizationId).toBe('org-selected')
  })

  it('uses filterIds when selectedId is null and filterIds is non-empty', () => {
    const result = resolveOrganizationScopeFilter(
      { selectedId: null, filterIds: ['org-a', 'org-b'], allowedIds: null, tenantId: 't1' },
      { orgId: 'org-auth' },
    )

    expect(result.organizationIds).toEqual(['org-a', 'org-b'])
    expect(result.where).toEqual({ organizationId: { $in: ['org-a', 'org-b'] } })
    expect(result.rbacOrganizationId).toBe('org-auth')
  })

  it('returns no where fragment when filterIds is explicitly null (wildcard scope)', () => {
    const result = resolveOrganizationScopeFilter(
      { selectedId: null, filterIds: null, allowedIds: null, tenantId: 't1' },
      { orgId: 'org-auth' },
    )

    expect(result.organizationIds).toBeUndefined()
    expect(result.where).toEqual({})
    expect(result.rbacOrganizationId).toBe('org-auth')
  })

  it('falls back to auth.orgId when scope lacks both selectedId and filterIds', () => {
    const result = resolveOrganizationScopeFilter(null, { orgId: 'org-auth' })

    expect(result.organizationIds).toEqual(['org-auth'])
    expect(result.where).toEqual({ organizationId: { $in: ['org-auth'] } })
    expect(result.rbacOrganizationId).toBe('org-auth')
  })

  it('returns no where fragment when scope and auth both lack org info', () => {
    const result = resolveOrganizationScopeFilter(null, { orgId: null })

    expect(result.organizationIds).toBeUndefined()
    expect(result.where).toEqual({})
    expect(result.rbacOrganizationId).toBeNull()
  })

  it('treats empty filterIds array as no scope and falls back to auth.orgId', () => {
    const result = resolveOrganizationScopeFilter(
      { selectedId: null, filterIds: [], allowedIds: null, tenantId: 't1' },
      { orgId: 'org-auth' },
    )

    expect(result.organizationIds).toEqual(['org-auth'])
    expect(result.where).toEqual({ organizationId: { $in: ['org-auth'] } })
    expect(result.rbacOrganizationId).toBe('org-auth')
  })

  it('accepts undefined auth gracefully', () => {
    const result = resolveOrganizationScopeFilter(
      { selectedId: 'org-selected', filterIds: null, allowedIds: null, tenantId: 't1' },
      undefined,
    )

    expect(result.organizationIds).toEqual(['org-selected'])
    expect(result.where).toEqual({ organizationId: { $in: ['org-selected'] } })
    expect(result.rbacOrganizationId).toBe('org-selected')
  })
})
