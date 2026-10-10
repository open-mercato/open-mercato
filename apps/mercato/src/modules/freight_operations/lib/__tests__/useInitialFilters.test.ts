/** @jest-environment node */
import { pickInitialFilters } from '../useInitialFilters'

describe('pickInitialFilters', () => {
  it('reads only the allowlisted keys', () => {
    const picked = pickInitialFilters('?status=confirmed&page=3&tab=notes', ['status'])
    expect(picked).toEqual({ status: 'confirmed' })
  })

  it('drops empty and whitespace-only values', () => {
    expect(pickInitialFilters('?status=&customerId=%20%20', ['status', 'customerId'])).toEqual({})
  })

  it('decodes encoded values and accepts a leading question mark or none', () => {
    expect(pickInitialFilters('status=in_abstract', ['status'])).toEqual({ status: 'in_abstract' })
    expect(pickInitialFilters('?q=Riyadh%20%E2%86%92%20Dammam', ['q'])).toEqual({ q: 'Riyadh → Dammam' })
  })

  it('returns nothing for an absent key', () => {
    expect(pickInitialFilters('', ['status', 'contractId'])).toEqual({})
  })
})
