import { recordListPropsSchema } from '../record-list'

const noop = () => undefined
const item = { id: 'job-1', title: 'Warehouse team lead' }
const base = { title: 'Job history', items: [item] }

describe('RecordList contract', () => {
  it('accepts a minimal list with a title', () => {
    expect(recordListPropsSchema.safeParse(base).success).toBe(true)
  })

  it('accepts an untitled list named by ariaLabel', () => {
    expect(recordListPropsSchema.safeParse({ ariaLabel: 'Job history', items: [] }).success).toBe(true)
  })

  it('accepts a full list', () => {
    const result = recordListPropsSchema.safeParse({
      title: 'Recent orders',
      count: 28,
      headingLevel: 2,
      items: [
        {
          id: 'order-1',
          title: 'Order 1042',
          href: '/orders/1',
          icon: 'shopping-cart',
          badge: { label: 'Paid', tone: 'success' },
          subtitle: 'Lena Brandt',
          meta: '12 Mar 2026',
          description: 'Two pallets, delivery to the northern dock.',
          trailing: '1,240.00 EUR',
          actions: [
            { key: 'edit', label: 'Edit', icon: 'pencil-line' },
            { key: 'delete', label: 'Delete', tone: 'destructive' },
          ],
        },
        {
          id: 'order-2',
          title: 'Order 1041',
          avatarLabel: 'Tomas Reed',
          avatarUrl: '/avatars/tomas.png',
          badges: [
            { label: 'Key account', tone: 'info' },
            { label: 'Renewal due', tone: 'neutral' },
          ],
          disabled: true,
        },
      ],
      addAction: { label: 'Add order', icon: 'plus-square' },
      onAdd: noop,
      onItemClick: noop,
      onItemAction: noop,
      renderItem: () => null,
      layout: 'cards',
      density: 'compact',
      variant: 'plain',
      maxItems: 5,
      onShowAll: noop,
      showAllLabel: 'Show all orders',
      emptyTitle: 'No orders yet',
      emptyDescription: 'Orders show up here.',
      emptyIcon: 'shopping-cart',
      skeleton: { rows: 4, leading: 'avatar' },
      status: 'ready',
    })
    expect(result.success).toBe(true)
  })

  it('requires items and a title or ariaLabel', () => {
    expect(recordListPropsSchema.safeParse({ title: 'Job history' }).success).toBe(false)
    const result = recordListPropsSchema.safeParse({ items: [item] })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['ariaLabel'])
  })

  it('rejects duplicate item ids', () => {
    const result = recordListPropsSchema.safeParse({ ...base, items: [item, { ...item, title: 'Picker' }] })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.message).toBe('Item ids must be unique')
  })

  it('rejects duplicate action keys inside one item', () => {
    const result = recordListPropsSchema.safeParse({
      ...base,
      onItemAction: noop,
      items: [{ ...item, actions: [{ key: 'edit', label: 'Edit' }, { key: 'edit', label: 'Edit again' }] }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects an item with both an icon and an avatar', () => {
    const result = recordListPropsSchema.safeParse({ ...base, items: [{ ...item, icon: 'user', avatarLabel: 'Lena Brandt' }] })
    expect(result.success).toBe(false)
  })

  it('rejects an avatar image without a label and a badge next to badges', () => {
    const image = recordListPropsSchema.safeParse({ ...base, items: [{ ...item, avatarUrl: '/avatars/lena.png' }] })
    expect(image.success).toBe(false)
    if (!image.success) expect(image.error.issues[0]?.message).toBe('avatarUrl requires avatarLabel')
    const both = recordListPropsSchema.safeParse({
      ...base,
      items: [{ ...item, badge: { label: 'Paid', tone: 'success' }, badges: [{ label: 'Paid', tone: 'success' }] }],
    })
    expect(both.success).toBe(false)
    if (!both.success) expect(both.error.issues[0]?.path).toEqual(['items', 0, 'badges'])
  })

  it('rejects a skeleton with bad rows or an unknown leading visual', () => {
    expect(recordListPropsSchema.safeParse({ ...base, skeleton: { rows: 0 } }).success).toBe(false)
    expect(recordListPropsSchema.safeParse({ ...base, skeleton: { rows: 40 } }).success).toBe(false)
    expect(recordListPropsSchema.safeParse({ ...base, skeleton: { leading: 'photo' } }).success).toBe(false)
    expect(recordListPropsSchema.safeParse({ ...base, skeleton: { rows: 5, leading: 'icon' } }).success).toBe(true)
  })

  it('rejects item actions without onItemAction unless every action is a link', () => {
    const withButton = recordListPropsSchema.safeParse({ ...base, items: [{ ...item, actions: [{ key: 'edit', label: 'Edit' }] }] })
    expect(withButton.success).toBe(false)
    if (!withButton.success) expect(withButton.error.issues[0]?.path).toEqual(['onItemAction'])
    const withLink = recordListPropsSchema.safeParse({
      ...base,
      items: [{ ...item, actions: [{ key: 'open', label: 'Open', href: '/jobs/1' }] }],
    })
    expect(withLink.success).toBe(true)
  })

  it('requires onAdd or href for the add action', () => {
    const missing = recordListPropsSchema.safeParse({ ...base, addAction: { label: 'Add position' } })
    expect(missing.success).toBe(false)
    if (!missing.success) expect(missing.error.issues[0]?.path).toEqual(['onAdd'])
    expect(recordListPropsSchema.safeParse({ ...base, addAction: { label: 'Add position', href: '/jobs/new' } }).success).toBe(true)
  })

  it('rejects a disabledReason on an enabled add action', () => {
    const result = recordListPropsSchema.safeParse({
      ...base,
      onAdd: noop,
      addAction: { label: 'Add position', disabledReason: 'Save the member first' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects unknown enums, bad numbers and empty labels', () => {
    expect(recordListPropsSchema.safeParse({ ...base, layout: 'table' }).success).toBe(false)
    expect(recordListPropsSchema.safeParse({ ...base, density: 'dense' }).success).toBe(false)
    expect(recordListPropsSchema.safeParse({ ...base, variant: 'outlined' }).success).toBe(false)
    expect(recordListPropsSchema.safeParse({ ...base, headingLevel: 5 }).success).toBe(false)
    expect(recordListPropsSchema.safeParse({ ...base, maxItems: 0 }).success).toBe(false)
    expect(recordListPropsSchema.safeParse({ ...base, count: -1 }).success).toBe(false)
    expect(recordListPropsSchema.safeParse({ ...base, showAllLabel: '' }).success).toBe(false)
    expect(recordListPropsSchema.safeParse({ ...base, items: [{ id: 'job-1', title: '' }] }).success).toBe(false)
    expect(recordListPropsSchema.safeParse({ ...base, items: [{ ...item, icon: 'Not An Icon' }] }).success).toBe(false)
    expect(recordListPropsSchema.safeParse({ ...base, items: [{ ...item, badge: { label: 'Paid', tone: 'gold' } }] }).success).toBe(false)
    expect(recordListPropsSchema.safeParse({ ...base, items: [{ ...item, description: '' }] }).success).toBe(false)
    expect(recordListPropsSchema.safeParse({ ...base, emptyIcon: 'Not An Icon' }).success).toBe(false)
  })

  it('rejects callbacks that are not functions', () => {
    expect(recordListPropsSchema.safeParse({ ...base, onItemClick: 'open' }).success).toBe(false)
    expect(recordListPropsSchema.safeParse({ ...base, renderItem: 'row' }).success).toBe(false)
  })
})
