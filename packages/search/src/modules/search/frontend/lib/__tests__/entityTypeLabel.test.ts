import { formatEntityId, resolveEntityTypeLabel } from '../entityTypeLabel'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

describe('formatEntityId', () => {
  it('humanizes module · entity', () => {
    expect(formatEntityId('customers:customer_person_profile')).toBe('Customers · Customer Person Profile')
  })
  it('humanizes a bare segment', () => {
    expect(formatEntityId('messages')).toBe('Messages')
  })
})

describe('resolveEntityTypeLabel', () => {
  const t: TranslateFn = (key, fallbackOrParams) =>
    key === 'search.entityType.sales.sales_order'
      ? 'Order'
      : (typeof fallbackOrParams === 'string' ? fallbackOrParams : key)

  it('returns the translated label when a key exists', () => {
    expect(resolveEntityTypeLabel(t, 'sales:sales_order')).toBe('Order')
  })
  it('falls back to the humanized string for unknown entity types', () => {
    expect(resolveEntityTypeLabel(t, 'thirdparty:widget_thing')).toBe('Thirdparty · Widget Thing')
  })
})
