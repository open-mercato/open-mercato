import {
  applyGroupHidden,
  collectGroupItemKeys,
  resolveGroupVisibility,
  resolveItemKey,
  type SidebarGroup,
} from '../customization-helpers'

// Hiding a whole group used to require toggling every item in it individually — `AppShell` drops a
// group only once *all* of its items are hidden. These cases cover the bulk toggle that does it in one
// action, and pin the invariant that matters for compatibility: it writes the same `hiddenItemIds`
// keys the per-item switches write, and nothing else.

const group: SidebarGroup = {
  id: 'catalog.nav.group',
  name: 'Catalog',
  items: [
    { href: '/backend/catalog/products', title: 'Products' },
    {
      href: '/backend/catalog/categories',
      title: 'Categories',
      children: [
        { href: '/backend/catalog/categories/tree', title: 'Tree' },
        { href: '/backend/catalog/categories/import', title: 'Import' },
      ],
    },
  ],
}

const ALL_KEYS = [
  '/backend/catalog/products',
  '/backend/catalog/categories',
  '/backend/catalog/categories/tree',
  '/backend/catalog/categories/import',
]

describe('collectGroupItemKeys', () => {
  it('includes top-level items and every nested descendant', () => {
    expect(collectGroupItemKeys(group).sort()).toEqual([...ALL_KEYS].sort())
  })

  it('returns nothing for an empty group', () => {
    expect(collectGroupItemKeys({ id: 'empty', name: 'Empty', items: [] })).toEqual([])
  })

  it('prefers an explicit item id over the href, matching resolveItemKey', () => {
    const withIds: SidebarGroup = {
      id: 'g',
      name: 'G',
      items: [{ id: 'custom-id', href: '/backend/thing', title: 'Thing' }],
    }

    expect(collectGroupItemKeys(withIds)).toEqual([resolveItemKey(withIds.items[0])])
  })
})

describe('resolveGroupVisibility', () => {
  it('is visible when nothing is hidden', () => {
    expect(resolveGroupVisibility(group, {})).toBe('visible')
  })

  it('is hidden only when every item including descendants is hidden', () => {
    const allHidden = Object.fromEntries(ALL_KEYS.map((key) => [key, true]))

    expect(resolveGroupVisibility(group, allHidden)).toBe('hidden')
  })

  it('is partial when some but not all items are hidden', () => {
    expect(resolveGroupVisibility(group, { '/backend/catalog/products': true })).toBe('partial')
  })

  it('is partial when only a nested descendant is left visible', () => {
    const allButOne = Object.fromEntries(
      ALL_KEYS.filter((key) => key !== '/backend/catalog/categories/import').map((key) => [key, true]),
    )

    expect(resolveGroupVisibility(group, allButOne)).toBe('partial')
  })

  it('treats an empty group as visible rather than hidden', () => {
    expect(resolveGroupVisibility({ id: 'empty', name: 'Empty', items: [] }, {})).toBe('visible')
  })
})

describe('applyGroupHidden', () => {
  it('hides every item in the group, descendants included', () => {
    const next = applyGroupHidden({}, group, true)

    expect(Object.keys(next).sort()).toEqual([...ALL_KEYS].sort())
    expect(resolveGroupVisibility(group, next)).toBe('hidden')
  })

  it('clears every item in the group when shown', () => {
    const hidden = applyGroupHidden({}, group, true)
    const next = applyGroupHidden(hidden, group, false)

    expect(next).toEqual({})
    expect(resolveGroupVisibility(group, next)).toBe('visible')
  })

  it('leaves keys belonging to other groups untouched', () => {
    const other = { '/backend/sales/orders': true }

    expect(applyGroupHidden(other, group, true)['/backend/sales/orders']).toBe(true)
    expect(applyGroupHidden(other, group, false)).toEqual(other)
  })

  it('does not mutate the input map', () => {
    const input = { '/backend/sales/orders': true }
    const snapshot = { ...input }

    applyGroupHidden(input, group, true)

    expect(input).toEqual(snapshot)
  })

  it('reaches the same state as toggling each item by hand', () => {
    const byHand = ALL_KEYS.reduce<Record<string, boolean>>((acc, key) => {
      acc[key] = true
      return acc
    }, {})

    expect(applyGroupHidden({}, group, true)).toEqual(byHand)
  })

  it('is idempotent', () => {
    const once = applyGroupHidden({}, group, true)

    expect(applyGroupHidden(once, group, true)).toEqual(once)
  })
})
