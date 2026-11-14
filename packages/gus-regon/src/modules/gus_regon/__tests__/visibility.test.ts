import { shouldRenderCompanyLookup } from '../lib/visibility'

describe('shouldRenderCompanyLookup', () => {
  it('renders on the company create page', () => {
    expect(shouldRenderCompanyLookup('/backend/customers/companies/create', 'create', { addresses: [] })).toBe(true)
    expect(shouldRenderCompanyLookup('/backend/customers/companies/create', undefined, {})).toBe(true)
  })

  it('renders on the company edit form (v2 and legacy routes)', () => {
    expect(shouldRenderCompanyLookup('/backend/customers/companies-v2/0b5c', 'update', { displayName: 'Acme' })).toBe(true)
    expect(shouldRenderCompanyLookup('/backend/customers/companies/0b5c', 'update', { displayName: 'Acme' })).toBe(true)
  })

  it('does not render in the "add person" dialog opened from a company page', () => {
    expect(shouldRenderCompanyLookup('/backend/customers/companies-v2/0b5c', 'create', { addresses: [] })).toBe(false)
    expect(shouldRenderCompanyLookup('/backend/customers/companies-v2/0b5c', 'create', { companyEntityId: '0b5c' })).toBe(false)
  })

  it('does not render for person forms, even on company routes', () => {
    expect(shouldRenderCompanyLookup('/backend/customers/companies-v2/0b5c', 'update', { firstName: 'Jan' })).toBe(false)
    expect(shouldRenderCompanyLookup('/backend/customers/people/create', 'create', {})).toBe(false)
    expect(shouldRenderCompanyLookup('/backend/customers/people-v2/1', 'update', {})).toBe(false)
  })
})
