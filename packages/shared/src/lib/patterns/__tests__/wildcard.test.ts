import { matchWildcardPattern } from '../wildcard'

describe('matchWildcardPattern', () => {
  it('matches exact values and the global wildcard', () => {
    expect(matchWildcardPattern('customers.person.created', 'customers.person.created')).toBe(true)
    expect(matchWildcardPattern('customers.person.created', '*')).toBe(true)
    expect(matchWildcardPattern('customers.person.created', 'sales.order.created')).toBe(false)
  })

  it('matches multi-segment wildcard patterns without regex execution', () => {
    expect(matchWildcardPattern('example.todo.created', 'example.*')).toBe(true)
    expect(matchWildcardPattern('example.todo.created', 'example.*.created')).toBe(true)
    expect(matchWildcardPattern('example.todo.created', '*.todo.*')).toBe(true)
    expect(matchWildcardPattern('example.todo.created', 'customers.*')).toBe(false)
  })

  it('can restrict wildcards to a single dotted segment', () => {
    expect(matchWildcardPattern('customers.person', 'customers.*', { singleSegmentWildcard: true })).toBe(true)
    expect(matchWildcardPattern('customers.person.deleted', 'customers.*', { singleSegmentWildcard: true })).toBe(false)
  })

  it('treats regex metacharacters as literals', () => {
    expect(matchWildcardPattern('cache:(tenant)[1]', 'cache:(tenant)[*]')).toBe(true)
    expect(matchWildcardPattern('cache:(tenant)[1]', 'cache:.+')).toBe(false)
  })
})

