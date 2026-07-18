import { resolveOrganizationScopeFilter } from '../organizationScopeFilter'

describe('resolveOrganizationScopeFilter', () => {
  it('uses an $in filter when organizationIds is a non-empty array (All Organizations scope)', () => {
    const result = resolveOrganizationScopeFilter({
      organizationIds: ['org-a', 'org-b'],
      selectedOrganizationId: 'org-a',
    })
    expect(result).toEqual({ organizationId: { $in: ['org-a', 'org-b'] } })
  })

  it('falls back to selectedOrganizationId when organizationIds is null', () => {
    const result = resolveOrganizationScopeFilter({
      organizationIds: null,
      selectedOrganizationId: 'org-a',
    })
    expect(result).toEqual({ organizationId: 'org-a' })
  })

  it('falls back to selectedOrganizationId when organizationIds is an empty array', () => {
    const result = resolveOrganizationScopeFilter({
      organizationIds: [],
      selectedOrganizationId: 'org-a',
    })
    expect(result).toEqual({ organizationId: 'org-a' })
  })

  it('falls back to selectedOrganizationId when organizationIds is omitted', () => {
    const result = resolveOrganizationScopeFilter({ selectedOrganizationId: 'org-a' })
    expect(result).toEqual({ organizationId: 'org-a' })
  })

  it('returns organizationId: undefined when neither scope is provided', () => {
    const result = resolveOrganizationScopeFilter({ organizationIds: null, selectedOrganizationId: null })
    expect(result).toEqual({ organizationId: undefined })
  })
})
