import {
  withActiveCustomerPersonCompanyLinkFilter,
  withCustomerPersonCompanyLinkScope,
  withScopedCustomerDealLinkWhere,
} from '../personCompanyLinkTable'

// Regression guard for #2736: the people/companies list routes resolve their
// `excludeLinked*` params by querying the person↔company and deal↔person/company
// link tables. `findWithDecryption` forwards the WHERE verbatim to `em.find` and
// uses tenant/org only for decryption fallback — so the link lookups MUST carry
// tenant/org in the WHERE clause itself. These helpers are the single source of
// truth for that scoping; before the fix the lookups were unbounded by tenant.
describe('customer link-table tenant/org scoping (#2736)', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111'
  const organizationId = '22222222-2222-4222-8222-222222222222'

  describe('withCustomerPersonCompanyLinkScope', () => {
    it('adds tenant and organization columns when both are present', () => {
      const where = withCustomerPersonCompanyLinkScope({ company: 'company-1' }, { tenantId, organizationId })
      expect(where).toEqual({ company: 'company-1', tenantId, organizationId })
    })

    it('adds only the tenant column when organization scope is absent', () => {
      const where = withCustomerPersonCompanyLinkScope({ person: 'person-1' }, { tenantId, organizationId: null })
      expect(where).toEqual({ person: 'person-1', tenantId })
      expect(where).not.toHaveProperty('organizationId')
    })

    it('leaves the base WHERE untouched when no scope is available', () => {
      const where = withCustomerPersonCompanyLinkScope({ company: 'company-1' }, { tenantId: null, organizationId: null })
      expect(where).toEqual({ company: 'company-1' })
    })

    it('does not mutate the caller-provided WHERE object', () => {
      const base = { company: 'company-1' }
      withCustomerPersonCompanyLinkScope(base, { tenantId, organizationId })
      expect(base).toEqual({ company: 'company-1' })
    })

    it('composes with the active-link filter to a fully scoped WHERE', async () => {
      const scoped = withCustomerPersonCompanyLinkScope({ company: 'company-1' }, { tenantId, organizationId })
      const where = await withActiveCustomerPersonCompanyLinkFilter({} as never, scoped, 'test')
      expect(where).toEqual({ company: 'company-1', tenantId, organizationId, deletedAt: null })
    })
  })

  describe('withScopedCustomerDealLinkWhere', () => {
    it('scopes deal-link lookups through the tenant-owned deal aggregate', () => {
      const where = withScopedCustomerDealLinkWhere('deal-1', { tenantId, organizationId })
      expect(where).toEqual({ deal: { id: 'deal-1', tenantId, organizationId } })
    })

    it('omits the organization filter when organization scope is absent', () => {
      const where = withScopedCustomerDealLinkWhere('deal-1', { tenantId, organizationId: null })
      expect(where).toEqual({ deal: { id: 'deal-1', tenantId } })
      expect(where.deal).not.toHaveProperty('organizationId')
    })

    it('omits the tenant filter when tenant scope is absent', () => {
      const where = withScopedCustomerDealLinkWhere('deal-1', { tenantId: null, organizationId })
      expect(where).toEqual({ deal: { id: 'deal-1', organizationId } })
    })
  })
})
