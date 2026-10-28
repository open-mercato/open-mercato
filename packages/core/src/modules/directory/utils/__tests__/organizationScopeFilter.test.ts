import { resolveOrganizationScopeFilter, resolveSingleOrganizationIdOrDeny } from '../organizationScopeFilter'

describe('resolveSingleOrganizationIdOrDeny', () => {
  const auth = { orgId: 'org-auth' }

  it('prefers a selected organization', () => {
    expect(resolveSingleOrganizationIdOrDeny(
      { selectedId: 'org-selected', filterIds: ['org-selected'], allowedIds: ['org-selected'], tenantId: 't1' },
      auth,
    )).toBe('org-selected')
  })

  it('preserves the home-organization fallback for unrestricted and absent scopes', () => {
    expect(resolveSingleOrganizationIdOrDeny(
      { selectedId: null, filterIds: null, allowedIds: null, tenantId: 't1' },
      auth,
    )).toBe('org-auth')
    expect(resolveSingleOrganizationIdOrDeny(undefined, auth)).toBe('org-auth')
  })

  it.each([
    { selectedId: null, filterIds: [], allowedIds: [], tenantId: 't1' },
    { selectedId: null, filterIds: [], allowedIds: null, tenantId: 't1' },
    { selectedId: null, filterIds: null, allowedIds: [], tenantId: 't1' },
  ])('denies an explicit finite empty scope before any home-organization fallback', (scope) => {
    expect(() => resolveSingleOrganizationIdOrDeny(scope, auth)).toThrow(
      expect.objectContaining({ status: 403, body: { error: 'Forbidden' } }),
    )
  })
})

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

  it('preserves an empty filterIds array as deny-all even when auth has a home organization', () => {
    const result = resolveOrganizationScopeFilter(
      { selectedId: null, filterIds: [], allowedIds: [], tenantId: 't1' },
      { orgId: 'org-auth' },
    )

    expect(result.organizationIds).toEqual([])
    expect(result.where).toEqual({ organizationId: { $in: [] } })
    expect(result.rbacOrganizationId).toBeNull()
  })

  it('does not fall back to auth.orgId when a resolved restricted scope lacks a selection', () => {
    const result = resolveOrganizationScopeFilter(
      { selectedId: null, filterIds: [], allowedIds: ['org-a'], tenantId: 't1' },
      { orgId: 'org-auth' },
    )

    expect(result.organizationIds).toEqual([])
    expect(result.where).toEqual({ organizationId: { $in: [] } })
    expect(result.rbacOrganizationId).toBeNull()
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
