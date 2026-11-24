import { timelineItemSchema, timelinePropsSchema } from '../timeline'

const item = {
  id: 'i-1',
  occurredAt: '2026-11-24T09:30:00Z',
  kind: 'call',
  icon: 'phone',
  title: 'Call with buyer',
}

describe('Timeline contract', () => {
  it('accepts a minimal item', () => {
    expect(timelineItemSchema.safeParse(item).success).toBe(true)
  })

  it('rejects items with non-ISO dates', () => {
    expect(timelineItemSchema.safeParse({ ...item, occurredAt: 'yesterday' }).success).toBe(false)
  })

  it('rejects an activeFilterKey when there are no filters', () => {
    expect(timelinePropsSchema.safeParse({ items: [], order: 'desc', activeFilterKey: 'all' }).success).toBe(false)
  })

  it('accepts a full timeline', () => {
    const result = timelinePropsSchema.safeParse({
      items: [
        {
          ...item,
          author: { name: 'Jan Kowalski' },
          attachments: [{ name: 'offer.pdf', format: 'pdf' }],
          status: { label: 'Done', tone: 'success' },
          actions: [{ key: 'delete', label: 'Delete', tone: 'destructive' }],
        },
      ],
      groupBy: 'day',
      order: 'desc',
      filters: [{ key: 'all', label: 'All', count: 1 }],
      activeFilterKey: 'all',
      hasMore: true,
      onItemAction: () => undefined,
      onFilterChange: () => undefined,
      onLoadMore: async () => undefined,
      renderItemBody: () => null,
    })
    expect(result.success).toBe(true)
  })

  it('requires order', () => {
    expect(timelinePropsSchema.safeParse({ items: [item] }).success).toBe(false)
  })

  it('rejects duplicate item ids', () => {
    expect(timelinePropsSchema.safeParse({ items: [item, item], order: 'desc' }).success).toBe(false)
  })

  it('rejects hasMore without onLoadMore and item actions without onItemAction', () => {
    expect(timelinePropsSchema.safeParse({ items: [item], order: 'desc', hasMore: true }).success).toBe(false)
    expect(
      timelinePropsSchema.safeParse({
        items: [{ ...item, actions: [{ key: 'delete', label: 'Delete' }] }],
        order: 'desc',
      }).success,
    ).toBe(false)
  })

  it('rejects an activeFilterKey outside filters and filters without onFilterChange', () => {
    expect(
      timelinePropsSchema.safeParse({
        items: [item],
        order: 'desc',
        filters: [{ key: 'all', label: 'All' }],
        activeFilterKey: 'calls',
        onFilterChange: () => undefined,
      }).success,
    ).toBe(false)
    expect(
      timelinePropsSchema.safeParse({ items: [item], order: 'desc', filters: [{ key: 'all', label: 'All' }] }).success,
    ).toBe(false)
  })
})
