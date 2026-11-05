import { buildHrefWithReturnTo } from '../navigation/returnTo'

describe('buildHrefWithReturnTo', () => {
  it('adds returnTo to a plain href', () => {
    expect(buildHrefWithReturnTo('/backend/config/customers', '/backend/customers/companies-v2/123?tab=people')).toBe(
      '/backend/config/customers?returnTo=%2Fbackend%2Fcustomers%2Fcompanies-v2%2F123%3Ftab%3Dpeople',
    )
  })

  it('preserves existing query params and hashes', () => {
    expect(buildHrefWithReturnTo('/backend/config/dictionaries?kind=status#list', '/backend/customers/people')).toBe(
      '/backend/config/dictionaries?kind=status&returnTo=%2Fbackend%2Fcustomers%2Fpeople#list',
    )
  })

  it('does not overwrite an existing returnTo parameter', () => {
    expect(
      buildHrefWithReturnTo(
        '/backend/config/dictionaries?returnTo=%2Fbackend%2Fcustomers',
        '/backend/customers/companies-v2/123',
      ),
    ).toBe('/backend/config/dictionaries?returnTo=%2Fbackend%2Fcustomers')
  })
})
