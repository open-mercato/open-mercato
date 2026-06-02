import { appendCustomerListSortParams, resolveCustomerListSortField } from '../listSorting'

describe('customer list sorting', () => {
  it('maps supported table columns to API sort fields', () => {
    expect(resolveCustomerListSortField('name')).toBe('name')
    expect(resolveCustomerListSortField('email')).toBe('primaryEmail')
    expect(resolveCustomerListSortField('status')).toBe('status')
    expect(resolveCustomerListSortField('lifecycleStage')).toBe('lifecycleStage')
    expect(resolveCustomerListSortField('source')).toBe('source')
    expect(resolveCustomerListSortField('nextInteractionAt')).toBe('nextInteractionAt')
  })

  it('normalizes custom field column ids to query-engine selectors', () => {
    expect(resolveCustomerListSortField('cf_created_at_external')).toBe('cf:created_at_external')
    expect(resolveCustomerListSortField('cf:created_at_external')).toBe('cf:created_at_external')
  })

  it('ignores unsupported table columns', () => {
    expect(resolveCustomerListSortField('description')).toBeNull()
    expect(resolveCustomerListSortField('unknown')).toBeNull()
  })

  it('appends only the first supported active sort', () => {
    const params = new URLSearchParams()

    appendCustomerListSortParams(params, [
      { id: 'cf_created_at_external', desc: true },
      { id: 'name', desc: false },
    ])

    expect(params.get('sortField')).toBe('cf:created_at_external')
    expect(params.get('sortDir')).toBe('desc')
  })
})
