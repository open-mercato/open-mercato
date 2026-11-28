import { listToolbarPropsSchema } from '../list-toolbar'

const noop = () => undefined

describe('ListToolbar contract', () => {
  it('accepts an empty toolbar and a search-only toolbar', () => {
    expect(listToolbarPropsSchema.safeParse({}).success).toBe(true)
    expect(listToolbarPropsSchema.safeParse({ search: { value: '' }, onSearchChange: noop }).success).toBe(true)
  })

  it('accepts a full toolbar', () => {
    const result = listToolbarPropsSchema.safeParse({
      search: { value: 'north', placeholder: 'Search deals', debounceMs: 200, label: 'Search deals' },
      onSearchChange: noop,
      quickFilters: [{ id: 'mine', label: 'My deals', icon: 'user', active: true, count: 3 }],
      onQuickFilterToggle: noop,
      filtersActiveCount: 2,
      onOpenFilters: noop,
      chips: [{ id: 'stage', label: 'Stage: Won' }, { id: 'owner', label: 'Owner: Maria', removable: false }],
      onChipOpen: noop,
      onChipRemove: noop,
      onAddFilter: noop,
      onClearAll: noop,
      maxVisibleChips: 4,
      views: [{ id: 'table', label: 'Table' }, { id: 'board', label: 'Board', href: '/deals/board' }],
      activeViewId: 'board',
      onViewChange: noop,
      primaryAction: { key: 'create', label: 'New deal' },
      secondaryActions: [{ key: 'export', label: 'Export' }, { key: 'delete', label: 'Delete', tone: 'destructive' }],
      onAction: noop,
      resultSummary: '128 results',
      busy: true,
      sticky: 'top',
      stickyOffset: '0px',
      status: 'ready',
    })
    expect(result.success).toBe(true)
  })

  it('rejects search without onSearchChange', () => {
    const result = listToolbarPropsSchema.safeParse({ search: { value: '' } })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['onSearchChange'])
  })

  it('rejects a negative debounce', () => {
    expect(
      listToolbarPropsSchema.safeParse({ search: { value: '', debounceMs: -1 }, onSearchChange: noop }).success,
    ).toBe(false)
  })

  it('rejects duplicate quick filter, chip and view ids', () => {
    expect(
      listToolbarPropsSchema.safeParse({
        quickFilters: [
          { id: 'open', label: 'Open', active: false },
          { id: 'open', label: 'Open again', active: true },
        ],
      }).success,
    ).toBe(false)
    expect(
      listToolbarPropsSchema.safeParse({
        chips: [{ id: 'stage', label: 'Stage: Won' }, { id: 'stage', label: 'Stage: Lost' }],
      }).success,
    ).toBe(false)
    expect(
      listToolbarPropsSchema.safeParse({
        views: [{ id: 'table', label: 'Table' }, { id: 'table', label: 'Table again' }],
      }).success,
    ).toBe(false)
  })

  it('rejects an activeViewId that matches no view', () => {
    const result = listToolbarPropsSchema.safeParse({
      views: [{ id: 'table', label: 'Table' }],
      activeViewId: 'board',
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['activeViewId'])
    expect(listToolbarPropsSchema.safeParse({ activeViewId: 'table' }).success).toBe(false)
  })

  it('rejects actions without onAction', () => {
    expect(listToolbarPropsSchema.safeParse({ primaryAction: { key: 'create', label: 'New deal' } }).success).toBe(false)
    expect(
      listToolbarPropsSchema.safeParse({ secondaryActions: [{ key: 'export', label: 'Export' }] }).success,
    ).toBe(false)
  })

  it('rejects action keys repeated across primary and secondary actions', () => {
    const result = listToolbarPropsSchema.safeParse({
      primaryAction: { key: 'create', label: 'New deal' },
      secondaryActions: [{ key: 'create', label: 'Create another' }],
      onAction: noop,
    })
    expect(result.success).toBe(false)
  })

  it('rejects a destructive primary action', () => {
    const result = listToolbarPropsSchema.safeParse({
      primaryAction: { key: 'delete', label: 'Delete', tone: 'destructive' },
      onAction: noop,
    })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown sticky mode and a zero maxVisibleChips', () => {
    expect(listToolbarPropsSchema.safeParse({ sticky: 'bottom' }).success).toBe(false)
    expect(listToolbarPropsSchema.safeParse({ maxVisibleChips: 0 }).success).toBe(false)
  })

  it('accepts a filterBar slot and actions with an href', () => {
    expect(listToolbarPropsSchema.safeParse({ filterBar: 'Stage' }).success).toBe(true)
    expect(listToolbarPropsSchema.safeParse({ filterBar: null }).success).toBe(true)
    const result = listToolbarPropsSchema.safeParse({
      primaryAction: { key: 'create', label: 'New deal', href: '/backend/deals/create' },
      secondaryActions: [{ key: 'import', label: 'Import', href: '/backend/deals/import' }],
      onAction: noop,
    })
    expect(result.success).toBe(true)
    expect(listToolbarPropsSchema.safeParse({ primaryAction: { key: 'create', label: 'New deal', href: '' }, onAction: noop }).success).toBe(
      false,
    )
  })

  it('accepts chip handlers that take the id alone or the id and the chip element', () => {
    const chips = [{ id: 'stage', label: 'Stage: Negotiation' }]
    expect(listToolbarPropsSchema.safeParse({ chips, onChipOpen: (id: string) => id }).success).toBe(true)
    expect(
      listToolbarPropsSchema.safeParse({ chips, onChipOpen: (id: string, anchor: HTMLElement | null) => [id, anchor] }).success,
    ).toBe(true)
  })
})
