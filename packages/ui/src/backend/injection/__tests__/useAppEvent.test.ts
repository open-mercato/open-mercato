import { matchesPattern } from '../useAppEvent'

describe('matchesPattern', () => {
  it('matches DOM event wildcard patterns without regex execution', () => {
    expect(matchesPattern('*', 'customers.person.created')).toBe(true)
    expect(matchesPattern('customers.person.*', 'customers.person.created')).toBe(true)
    expect(matchesPattern('customers.*.created', 'customers.person.created')).toBe(true)
    expect(matchesPattern('sales.*', 'customers.person.created')).toBe(false)
  })

  it('treats regex metacharacters as literal event characters', () => {
    expect(matchesPattern('customers.(person).*', 'customers.(person).created')).toBe(true)
    expect(matchesPattern('customers.+.*', 'customers.person.created')).toBe(false)
  })
})

