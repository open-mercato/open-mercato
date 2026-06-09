import { formatEntityId, resolveEntityTypeLabel } from '../entityTypeLabel'

describe('formatEntityId', () => {
  it('humanizes module · entity', () => {
    expect(formatEntityId('customers:customer_person_profile')).toBe('Customers · Customer Person Profile')
  })
  it('humanizes a bare segment', () => {
    expect(formatEntityId('messages')).toBe('Messages')
  })
})

describe('resolveEntityTypeLabel', () => {
  const t = (key: string, fallback?: string) =>
    key === 'search.entityType.sales.sales_order' ? 'Order' : (fallback as string)

  it('returns the translated label when a key exists', () => {
    expect(resolveEntityTypeLabel(t as any, 'sales:sales_order')).toBe('Order')
  })
  it('falls back to the humanized string for unknown entity types', () => {
    expect(resolveEntityTypeLabel(t as any, 'thirdparty:widget_thing')).toBe('Thirdparty · Widget Thing')
  })
})
