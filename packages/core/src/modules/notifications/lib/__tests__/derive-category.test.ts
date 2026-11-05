import { deriveCategory } from '../derive-category'

describe('deriveCategory', () => {
  it('takes the prefix before the first dot', () => {
    expect(deriveCategory('sales.order.created')).toBe('sales')
    expect(deriveCategory('auth.login.new_device')).toBe('auth')
  })

  it('returns the whole id when there is no dot', () => {
    expect(deriveCategory('standalone')).toBe('standalone')
  })

  it('keeps underscores in the module segment', () => {
    expect(deriveCategory('customer_accounts.user.signup')).toBe('customer_accounts')
  })

  it('degrades to an empty key rather than throwing on malformed ids', () => {
    expect(deriveCategory('.leading')).toBe('')
    expect(deriveCategory('')).toBe('')
  })
})
