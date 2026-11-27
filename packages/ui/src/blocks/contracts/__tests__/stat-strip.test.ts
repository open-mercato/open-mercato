import { statStripPropsSchema } from '../stat-strip'

const noop = () => undefined
const items = [
  { id: 'open', label: 'Open claims', value: '128' },
  { id: 'overdue', label: 'Overdue', value: '12' },
]

describe('StatStrip contract', () => {
  it('accepts a minimal strip', () => {
    expect(statStripPropsSchema.safeParse({ items }).success).toBe(true)
  })

  it('accepts a full strip', () => {
    const result = statStripPropsSchema.safeParse({
      items: [
        {
          id: 'revenue',
          label: 'Revenue',
          value: '48 200.00',
          caption: 'Last 30 days',
          icon: 'wallet',
          delta: { direction: 'up', label: '12%', sentiment: 'positive' },
          trend: [31.2, 33.8, 32.1, 48.2],
          badge: { label: 'On track', tone: 'success' },
          tone: 'success',
          href: '/backend/reports/revenue',
        },
        { id: 'refunds', label: 'Refunds', value: '7', disabled: true },
        { id: 'margin', label: 'Margin', value: '38%', interactive: false },
        { id: 'stock', label: 'On hand', value: '420 pcs', action: { label: 'View stock', href: '/backend/stock' } },
        { id: 'returns', label: 'Returns', value: '7', action: { label: 'Review returns' } },
      ],
      onItemClick: noop,
      onItemAction: noop,
      selectedId: 'revenue',
      columns: 4,
      variant: 'plain',
      size: 'compact',
      ariaLabel: 'Sales summary',
      skeletonCount: 4,
      status: 'ready',
    })
    expect(result.success).toBe(true)
  })

  it('accepts an empty list so the block can render its empty state', () => {
    expect(statStripPropsSchema.safeParse({ items: [], status: 'loading', skeletonCount: 5 }).success).toBe(true)
  })

  it('requires items, a label and an already formatted string value', () => {
    expect(statStripPropsSchema.safeParse({}).success).toBe(false)
    expect(statStripPropsSchema.safeParse({ items: [{ id: 'open', value: '1' }] }).success).toBe(false)
    expect(statStripPropsSchema.safeParse({ items: [{ id: 'open', label: 'Open', value: 128 }] }).success).toBe(false)
    expect(statStripPropsSchema.safeParse({ items: [{ id: 'open', label: 'Open', value: '' }] }).success).toBe(false)
  })

  it('rejects duplicate item ids', () => {
    const result = statStripPropsSchema.safeParse({ items: [items[0], items[0]] })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Item ids must be unique')
      expect(result.error.issues[0]?.path).toEqual(['items'])
    }
  })

  it('rejects unknown options', () => {
    expect(statStripPropsSchema.safeParse({ items, columns: 7 }).success).toBe(false)
    expect(statStripPropsSchema.safeParse({ items, columns: 1 }).success).toBe(false)
    expect(statStripPropsSchema.safeParse({ items, variant: 'tiles' }).success).toBe(false)
    expect(statStripPropsSchema.safeParse({ items, size: 'large' }).success).toBe(false)
    expect(statStripPropsSchema.safeParse({ items, skeletonCount: 0 }).success).toBe(false)
  })

  it('rejects an invalid change indicator, badge tone and icon name', () => {
    const withDelta = (delta: unknown) => ({ items: [{ ...items[0], delta }] })
    expect(statStripPropsSchema.safeParse(withDelta({ direction: 'sideways', label: '1%' })).success).toBe(false)
    expect(statStripPropsSchema.safeParse(withDelta({ direction: 'up' })).success).toBe(false)
    expect(statStripPropsSchema.safeParse(withDelta({ direction: 'up', label: '1%', sentiment: 'good' })).success).toBe(false)
    expect(
      statStripPropsSchema.safeParse({ items: [{ ...items[0], badge: { label: 'New', tone: 'purple' } }] }).success,
    ).toBe(false)
    expect(statStripPropsSchema.safeParse({ items: [{ ...items[0], icon: 'TrendingUp' }] }).success).toBe(false)
  })

  it('rejects a selectedId that matches no item', () => {
    const result = statStripPropsSchema.safeParse({ items, onItemClick: noop, selectedId: 'closed' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('selectedId must match an item id')
      expect(result.error.issues[0]?.path).toEqual(['selectedId'])
    }
  })

  it('rejects a selected tile that cannot be activated', () => {
    const result = statStripPropsSchema.safeParse({ items, selectedId: 'open' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'selectedId requires an interactive item: onItemClick or an href, and no action',
      )
    }
    const plain = [{ ...items[0], interactive: false }, items[1]]
    expect(statStripPropsSchema.safeParse({ items: plain, onItemClick: noop, selectedId: 'open' }).success).toBe(false)
    const withAction = [{ ...items[0], action: { label: 'View claims', href: '/claims' } }, items[1]]
    expect(statStripPropsSchema.safeParse({ items: withAction, onItemClick: noop, selectedId: 'open' }).success).toBe(false)
    expect(
      statStripPropsSchema.safeParse({ items: [{ ...items[0], href: '/claims?status=open' }], selectedId: 'open' }).success,
    ).toBe(true)
  })

  it('rejects a callback that is not a function', () => {
    expect(statStripPropsSchema.safeParse({ items, onItemClick: 'open' }).success).toBe(false)
  })

  it('limits a trend to between 2 and 60 finite points', () => {
    const withTrend = (trend: unknown) => ({ items: [{ ...items[0], trend }] })
    expect(statStripPropsSchema.safeParse(withTrend([1, 2])).success).toBe(true)
    expect(statStripPropsSchema.safeParse(withTrend(Array.from({ length: 60 }, (_, index) => index))).success).toBe(true)
    expect(statStripPropsSchema.safeParse(withTrend([1])).success).toBe(false)
    expect(statStripPropsSchema.safeParse(withTrend(Array.from({ length: 61 }, (_, index) => index))).success).toBe(false)
    expect(statStripPropsSchema.safeParse(withTrend([1, Number.NaN])).success).toBe(false)
    expect(statStripPropsSchema.safeParse(withTrend([1, Number.POSITIVE_INFINITY])).success).toBe(false)
    expect(statStripPropsSchema.safeParse(withTrend(['1', '2'])).success).toBe(false)
  })

  it('lets a strip mix clickable and plain tiles', () => {
    const mixed = [items[0], { ...items[1], interactive: false }]
    expect(statStripPropsSchema.safeParse({ items: mixed, onItemClick: noop, selectedId: 'open' }).success).toBe(true)
  })

  it('rejects interactive: true when nothing can handle the click', () => {
    const result = statStripPropsSchema.safeParse({ items: [{ ...items[0], interactive: true }] })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('interactive: true requires onItemClick or an href')
    }
    expect(
      statStripPropsSchema.safeParse({ items: [{ ...items[0], interactive: true, href: '/claims' }] }).success,
    ).toBe(true)
  })

  it('rejects interactive: false on a link tile', () => {
    const result = statStripPropsSchema.safeParse({ items: [{ ...items[0], interactive: false, href: '/claims' }] })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('interactive: false cannot be combined with href')
    }
  })

  it('rejects an item that has an action and is also a link or interactive', () => {
    const action = { label: 'View claims', href: '/claims' }
    const asLink = statStripPropsSchema.safeParse({ items: [{ ...items[0], action, href: '/claims' }] })
    expect(asLink.success).toBe(false)
    if (!asLink.success) {
      expect(asLink.error.issues[0]?.message).toBe('An item with an action cannot also be a link')
    }
    const asInteractive = statStripPropsSchema.safeParse({
      items: [{ ...items[0], action, interactive: true }],
      onItemClick: noop,
    })
    expect(asInteractive.success).toBe(false)
    if (!asInteractive.success) {
      expect(asInteractive.error.issues[0]?.message).toBe('An item with an action cannot be interactive')
    }
  })

  it('requires onItemAction for an action without href', () => {
    const withAction = [{ ...items[0], action: { label: 'Review claims' } }]
    const result = statStripPropsSchema.safeParse({ items: withAction })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('An action without href requires onItemAction')
      expect(result.error.issues[0]?.path).toEqual(['onItemAction'])
    }
    expect(statStripPropsSchema.safeParse({ items: withAction, onItemAction: noop }).success).toBe(true)
    expect(statStripPropsSchema.safeParse({ items: [{ ...items[0], action: { label: '' } }], onItemAction: noop }).success).toBe(false)
    expect(statStripPropsSchema.safeParse({ items: withAction, onItemAction: 'open' }).success).toBe(false)
  })
})
