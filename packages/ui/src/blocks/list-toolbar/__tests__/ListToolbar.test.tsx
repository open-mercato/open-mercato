import * as React from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ListToolbar } from '../ListToolbar'
import { listToolbarFixtures } from '../fixtures'
import { listToolbarPropsSchema, type ListToolbarProps } from '../../contracts/list-toolbar'

const dict = {
  ui: {
    blocks: {
      listToolbar: {
        label: 'List toolbar',
        searchLabel: 'Search',
        clearSearch: 'Clear search',
        busy: 'Updating results',
        quickFilters: 'Quick filters',
        filters: 'Filters',
        filtersActive: 'Filters, {count} active',
        appliedFilters: 'Applied filters',
        removeFilter: 'Remove filter {label}',
        moreFilters: '+{count} more',
        showFewer: 'Show fewer',
        addFilter: 'Add filter',
        clearAll: 'Clear all',
        views: 'View',
        moreActions: 'More actions',
        loading: 'Loading',
      },
    },
  },
}

function renderToolbar(props: ListToolbarProps) {
  return renderWithProviders(<ListToolbar {...props} />, { dict })
}

function slot(name: string): HTMLElement | null {
  return document.querySelector(`[data-slot="${name}"]`)
}

function searchBox(): HTMLInputElement {
  return screen.getByRole('searchbox', { name: 'Search' }) as HTMLInputElement
}

describe('ListToolbar', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('renders a labelled toolbar', () => {
    renderToolbar(listToolbarFixtures.full)
    expect(screen.getByRole('toolbar', { name: 'List toolbar' })).toBeInTheDocument()
  })

  it('shows the draft immediately and emits after the debounce', () => {
    jest.useFakeTimers()
    const onSearchChange = jest.fn()
    renderToolbar({ search: { value: '' }, onSearchChange })
    fireEvent.change(searchBox(), { target: { value: 'no' } })
    fireEvent.change(searchBox(), { target: { value: 'north' } })
    expect(searchBox().value).toBe('north')
    expect(onSearchChange).not.toHaveBeenCalled()
    act(() => {
      jest.advanceTimersByTime(299)
    })
    expect(onSearchChange).not.toHaveBeenCalled()
    act(() => {
      jest.advanceTimersByTime(1)
    })
    expect(onSearchChange).toHaveBeenCalledTimes(1)
    expect(onSearchChange).toHaveBeenCalledWith('north')
  })

  it('honours a custom debounce', () => {
    jest.useFakeTimers()
    const onSearchChange = jest.fn()
    renderToolbar({ search: { value: '', debounceMs: 50 }, onSearchChange })
    fireEvent.change(searchBox(), { target: { value: 'a' } })
    act(() => {
      jest.advanceTimersByTime(50)
    })
    expect(onSearchChange).toHaveBeenCalledWith('a')
  })

  it('emits immediately on Enter and not again when the debounce elapses', () => {
    jest.useFakeTimers()
    const onSearchChange = jest.fn()
    renderToolbar({ search: { value: '' }, onSearchChange })
    fireEvent.change(searchBox(), { target: { value: 'north' } })
    fireEvent.keyDown(searchBox(), { key: 'Enter' })
    expect(onSearchChange).toHaveBeenCalledTimes(1)
    expect(onSearchChange).toHaveBeenCalledWith('north')
    act(() => {
      jest.advanceTimersByTime(1000)
    })
    expect(onSearchChange).toHaveBeenCalledTimes(1)
  })

  it('clears the search immediately with the clear control', () => {
    const onSearchChange = jest.fn()
    renderToolbar({ search: { value: 'north' }, onSearchChange })
    expect(searchBox().value).toBe('north')
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(searchBox().value).toBe('')
    expect(onSearchChange).toHaveBeenCalledWith('')
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument()
  })

  it('follows an applied value changed by the host and keeps the draft while the host catches up', () => {
    jest.useFakeTimers()
    const onSearchChange = jest.fn()
    const view = renderToolbar({ search: { value: '' }, onSearchChange })
    fireEvent.change(searchBox(), { target: { value: 'a' } })
    act(() => {
      jest.advanceTimersByTime(300)
    })
    fireEvent.change(searchBox(), { target: { value: 'ab' } })
    view.rerender(<ListToolbar search={{ value: 'a' }} onSearchChange={onSearchChange} />)
    expect(searchBox().value).toBe('ab')
    view.rerender(<ListToolbar search={{ value: 'reset by host' }} onSearchChange={onSearchChange} />)
    expect(searchBox().value).toBe('reset by host')
    act(() => {
      jest.advanceTimersByTime(1000)
    })
    expect(onSearchChange).toHaveBeenCalledTimes(1)
  })

  it('renders quick filters as toggle buttons and reports the next state', () => {
    const onQuickFilterToggle = jest.fn()
    renderToolbar({ ...listToolbarFixtures.searchWithQuickFilters, onQuickFilterToggle })
    const group = screen.getByRole('group', { name: 'Quick filters' })
    const mine = within(group).getByRole('button', { name: /My deals/ })
    const open = within(group).getByRole('button', { name: /Open/ })
    expect(mine).toHaveAttribute('aria-pressed', 'true')
    expect(open).toHaveAttribute('aria-pressed', 'false')
    expect(mine).toHaveTextContent('12')
    fireEvent.click(mine)
    expect(onQuickFilterToggle).toHaveBeenCalledWith('mine', false)
    fireEvent.click(open)
    expect(onQuickFilterToggle).toHaveBeenCalledWith('open', true)
    expect(within(group).getByRole('button', { name: 'Won' })).toBeDisabled()
  })

  it('does not render the applied filters row without chips', () => {
    renderToolbar({ ...listToolbarFixtures.appliedFilters, chips: [] })
    expect(slot('list-toolbar-chips')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add filter' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument()
  })

  it('removes and opens a chip by id', () => {
    const onChipRemove = jest.fn()
    const onChipOpen = jest.fn()
    renderToolbar({ ...listToolbarFixtures.appliedFilters, onChipRemove, onChipOpen })
    expect(screen.getByRole('group', { name: 'Applied filters' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter Stage: Negotiation' }))
    expect(onChipRemove).toHaveBeenCalledWith('stage')
    fireEvent.click(screen.getByRole('button', { name: 'Owner: Maria Lindqvist' }))
    expect(onChipOpen).toHaveBeenCalledTimes(1)
    expect(onChipOpen.mock.calls[0][0]).toBe('owner')
  })

  it('renders no remove button for a chip that is not removable', () => {
    renderToolbar({
      chips: [{ id: 'pipeline', label: 'Pipeline: Renewals', removable: false }],
      onChipRemove: () => undefined,
    })
    expect(screen.getByText('Pipeline: Renewals')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove filter/ })).not.toBeInTheDocument()
  })

  it('calls onAddFilter and onClearAll and hides the buttons without the callbacks', () => {
    const onAddFilter = jest.fn()
    const onClearAll = jest.fn()
    const view = renderToolbar({ ...listToolbarFixtures.appliedFilters, onAddFilter, onClearAll })
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(onAddFilter).toHaveBeenCalledTimes(1)
    expect(onClearAll).toHaveBeenCalledTimes(1)
    view.rerender(<ListToolbar chips={listToolbarFixtures.appliedFilters.chips} />)
    expect(screen.queryByRole('button', { name: 'Add filter' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument()
  })

  it('collapses chips beyond the limit behind "+N more" and expands the row', () => {
    renderToolbar(listToolbarFixtures.manyAppliedFilters)
    expect(document.querySelectorAll('[data-slot="list-toolbar-chip"]')).toHaveLength(6)
    const toggle = screen.getByRole('button', { name: '+4 more' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(document.querySelectorAll('[data-slot="list-toolbar-chip"]')).toHaveLength(10)
    const collapse = screen.getByRole('button', { name: 'Show fewer' })
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(collapse)
    expect(document.querySelectorAll('[data-slot="list-toolbar-chip"]')).toHaveLength(6)
  })

  it('honours maxVisibleChips and shows no toggle when everything fits', () => {
    const view = renderToolbar({ ...listToolbarFixtures.appliedFilters, maxVisibleChips: 2 })
    expect(document.querySelectorAll('[data-slot="list-toolbar-chip"]')).toHaveLength(2)
    expect(screen.getByRole('button', { name: '+2 more' })).toBeInTheDocument()
    view.rerender(<ListToolbar {...listToolbarFixtures.appliedFilters} />)
    expect(slot('list-toolbar-chips-toggle')).toBeNull()
  })

  it('renders the view switch as a labelled group of toggle buttons', () => {
    const onViewChange = jest.fn()
    renderToolbar({ ...listToolbarFixtures.viewSwitch, onViewChange })
    const group = screen.getByRole('group', { name: 'View' })
    const table = within(group).getByRole('button', { name: 'Table' })
    const board = within(group).getByRole('button', { name: 'Board' })
    expect(table).toHaveAttribute('aria-pressed', 'true')
    expect(board).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(table)
    expect(onViewChange).not.toHaveBeenCalled()
    fireEvent.click(board)
    expect(onViewChange).toHaveBeenCalledWith('board')
  })

  it('renders views with href as real links and leaves modified clicks to the browser', () => {
    const onViewChange = jest.fn()
    renderToolbar({
      views: [
        { id: 'table', label: 'Table', href: '/deals' },
        { id: 'board', label: 'Board', href: '/deals/board' },
      ],
      activeViewId: 'table',
      onViewChange,
    })
    const group = screen.getByRole('group', { name: 'View' })
    const table = within(group).getByRole('link', { name: 'Table' })
    const board = within(group).getByRole('link', { name: 'Board' })
    expect(board).toHaveAttribute('href', '/deals/board')
    expect(table).toHaveAttribute('aria-current', 'true')
    expect(board).not.toHaveAttribute('aria-current')
    expect(fireEvent.click(board, { metaKey: true })).toBe(true)
    expect(onViewChange).not.toHaveBeenCalled()
    expect(fireEvent.click(board)).toBe(false)
    expect(onViewChange).toHaveBeenCalledWith('board')
  })

  it('does not intercept a link click without onViewChange', () => {
    renderToolbar({ views: [{ id: 'board', label: 'Board', href: '#board' }] })
    expect(fireEvent.click(screen.getByRole('link', { name: 'Board' }))).toBe(true)
  })

  it('shows the primary action, two secondary actions and a menu with every secondary action', () => {
    const onAction = jest.fn()
    renderToolbar({ ...listToolbarFixtures.withActions, onAction })
    const create = screen.getByRole('button', { name: 'New deal' })
    expect(create).toHaveAttribute('data-action-emphasis', 'primary')
    expect(create.className).not.toContain('hidden')
    const importButton = screen.getByRole('button', { name: 'Import' })
    expect(importButton).toHaveAttribute('data-action-emphasis', 'secondary')
    expect(importButton.className).toContain('hidden lg:inline-flex')
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit columns' })).not.toBeInTheDocument()
    fireEvent.click(create)
    expect(onAction).toHaveBeenCalledWith('create')
    const more = screen.getByRole('button', { name: 'More actions' })
    expect(more.className).not.toContain('lg:hidden')
    fireEvent.click(more)
    const phoneOnlyItem = document.querySelector('[data-action-key="import"]') as HTMLElement
    const overflowItem = document.querySelector('[data-action-key="columns"]') as HTMLElement
    expect(phoneOnlyItem.className).toContain('lg:hidden')
    expect(overflowItem.className).not.toContain('lg:hidden')
    fireEvent.click(screen.getByText('Edit columns'))
    expect(onAction).toHaveBeenCalledWith('columns')
  })

  it('keeps the menu for compact widths only when every secondary action fits on desktop', () => {
    renderToolbar({
      secondaryActions: [{ key: 'export', label: 'Export' }],
      onAction: () => undefined,
    })
    expect(screen.getByRole('button', { name: 'More actions' }).className).toContain('lg:hidden')
  })

  it('always keeps destructive actions in the menu', () => {
    renderToolbar({
      secondaryActions: [{ key: 'delete', label: 'Delete all', tone: 'destructive' }],
      onAction: () => undefined,
    })
    expect(screen.queryByRole('button', { name: 'Delete all' })).not.toBeInTheDocument()
    const more = screen.getByRole('button', { name: 'More actions' })
    expect(more.className).not.toContain('lg:hidden')
    fireEvent.click(more)
    expect(screen.getByText('Delete all')).toBeInTheDocument()
  })

  it('disables an action while its promise is pending', async () => {
    let resolve: () => void = () => undefined
    const pending = new Promise<void>((res) => {
      resolve = res
    })
    renderToolbar({ primaryAction: { key: 'create', label: 'New deal' }, onAction: () => pending })
    fireEvent.click(screen.getByRole('button', { name: 'New deal' }))
    expect(screen.getByRole('button', { name: /New deal/ })).toBeDisabled()
    await act(async () => {
      resolve()
      await pending
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'New deal' })).toBeEnabled())
  })

  it('keeps a disabled action with a reason focusable and inert', () => {
    const onAction = jest.fn()
    renderToolbar({
      primaryAction: { key: 'create', label: 'New deal', disabled: true, disabledReason: 'The pipeline is archived' },
      onAction,
    })
    const button = screen.getByRole('button', { name: 'New deal' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(button)
    expect(onAction).not.toHaveBeenCalled()
    const reasonId = button.getAttribute('aria-describedby') as string
    expect(document.getElementById(reasonId)).toHaveTextContent('The pipeline is archived')
  })

  it('renders no action controls without actions', () => {
    renderToolbar(listToolbarFixtures.searchOnly)
    expect(slot('list-toolbar-actions')).toBeNull()
    expect(slot('list-toolbar-end')).toBeNull()
  })

  it('passes its own button element to onOpenFilters and shows the count', () => {
    const onOpenFilters = jest.fn()
    renderToolbar({ filtersActiveCount: 3, onOpenFilters })
    const button = screen.getByRole('button', { name: 'Filters, 3 active' })
    expect(slot('list-toolbar-filters-count')).toHaveTextContent('3')
    fireEvent.click(button)
    expect(onOpenFilters).toHaveBeenCalledTimes(1)
    expect(onOpenFilters.mock.calls[0][0]).toBe(button)
  })

  it('renders the filters button without a badge when nothing is active', () => {
    renderToolbar({ onOpenFilters: () => undefined })
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument()
    expect(slot('list-toolbar-filters-count')).toBeNull()
  })

  it('renders the result summary and a busy indicator that disables nothing', () => {
    renderToolbar(listToolbarFixtures.busy)
    expect(screen.getByText('128 results')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Updating results')
    expect(searchBox()).toBeEnabled()
    for (const button of screen.getAllByRole('button')) expect(button).toBeEnabled()
  })

  it('renders leading, searchTrailing and trailing slots', () => {
    renderToolbar({
      ...listToolbarFixtures.searchOnly,
      leading: <span>Leading slot</span>,
      searchTrailing: <span>Search trailing slot</span>,
      trailing: <span>Trailing slot</span>,
    })
    expect(slot('list-toolbar-leading')).toHaveTextContent('Leading slot')
    expect(slot('list-toolbar-search-trailing')).toHaveTextContent('Search trailing slot')
    expect(slot('list-toolbar-trailing')).toHaveTextContent('Trailing slot')
  })

  it('renders a skeleton row while loading', () => {
    renderToolbar({ ...listToolbarFixtures.full, status: 'loading' })
    const root = slot('list-toolbar') as HTMLElement
    expect(root).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Loading')).toBeInTheDocument()
    expect(root.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(5)
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders normally for the error and empty statuses', () => {
    const view = renderToolbar({ ...listToolbarFixtures.searchOnly, status: 'error' })
    expect(screen.getByRole('toolbar')).toBeInTheDocument()
    view.rerender(<ListToolbar {...listToolbarFixtures.searchOnly} status="empty" />)
    expect(screen.getByRole('toolbar')).toBeInTheDocument()
  })

  it('stays in normal flow by default and sticks only when asked', () => {
    const view = renderToolbar(listToolbarFixtures.searchOnly)
    const bar = screen.getByRole('toolbar')
    expect(bar.className).not.toContain('sticky')
    expect(slot('list-toolbar-sentinel')).toBeNull()
    view.rerender(<ListToolbar {...listToolbarFixtures.sticky} />)
    const stickyBar = screen.getByRole('toolbar')
    expect(stickyBar.className).toContain('sticky')
    expect(stickyBar.className).toContain('z-sticky')
    expect(stickyBar.style.top).toBe('calc(-1px)')
    expect(slot('list-toolbar-sentinel')).not.toBeNull()
  })

  it('uses the topbar height variable as the default sticky offset', () => {
    renderToolbar({ ...listToolbarFixtures.sticky, stickyOffset: undefined })
    expect(screen.getByRole('toolbar').style.top).toBe('calc(var(--topbar-height, 0px) - 1px)')
  })

  it('marks the bar as stuck when the sentinel leaves the scroll area', () => {
    const original = window.IntersectionObserver
    let notify: (entries: Array<Partial<IntersectionObserverEntry>>) => void = () => undefined
    class FakeObserver {
      constructor(callback: (entries: IntersectionObserverEntry[]) => void) {
        notify = (entries) => callback(entries as IntersectionObserverEntry[])
      }
      observe() {}
      disconnect() {}
    }
    window.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver
    try {
      renderToolbar(listToolbarFixtures.sticky)
      const bar = screen.getByRole('toolbar')
      expect(bar).not.toHaveAttribute('data-stuck')
      act(() => {
        notify([
          {
            intersectionRatio: 0,
            boundingClientRect: { top: -1 } as DOMRectReadOnly,
            rootBounds: { top: 0 } as DOMRectReadOnly,
          },
        ])
      })
      expect(bar).toHaveAttribute('data-stuck', 'true')
      expect(bar.className).toContain('border-border')
      act(() => {
        notify([
          {
            intersectionRatio: 1,
            boundingClientRect: { top: 40 } as DOMRectReadOnly,
            rootBounds: { top: 0 } as DOMRectReadOnly,
          },
        ])
      })
      expect(bar).not.toHaveAttribute('data-stuck')
    } finally {
      window.IntersectionObserver = original
    }
  })

  it('parses every fixture against the contract schema', () => {
    for (const [name, fixture] of Object.entries(listToolbarFixtures)) {
      expect({ name, ok: listToolbarPropsSchema.safeParse(fixture).success }).toEqual({ name, ok: true })
    }
  })
})
