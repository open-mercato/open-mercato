import * as React from 'react'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { RecordList } from '../RecordList'
import { recordListFixtures } from '../fixtures'
import { recordListPropsSchema, type RecordListProps } from '../../contracts/record-list'

const dict = {
  ui: {
    blocks: {
      recordList: {
        actionFor: '{action}: {title}',
        itemActions: 'Actions for {title}',
        count: '{count} in total',
        loading: 'Loading',
        error: 'Could not load the list',
        retry: 'Try again',
        empty: 'Nothing here yet',
        emptyDescription: 'Records will show up here once they are added.',
        showAll: 'Show all {count}',
        moreBadges: '{count} more: {labels}',
      },
    },
  },
}

function renderList(props: RecordListProps) {
  return renderWithProviders(<RecordList {...props} />, { dict })
}

function root() {
  return document.querySelector('[data-slot="record-list"]') as HTMLElement
}

function rows() {
  return Array.from(document.querySelectorAll('[data-slot="record-list-item"]')) as HTMLElement[]
}

function deferred() {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('RecordList', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn()
  })

  it('keeps every fixture valid against the contract', () => {
    for (const fixture of Object.values(recordListFixtures)) {
      expect(recordListPropsSchema.safeParse(fixture).success).toBe(true)
    }
  })

  it('renders a real list named by its heading, with the count next to the title', () => {
    renderList(recordListFixtures.childRecords)
    const heading = screen.getByRole('heading', { level: 3, name: 'Job history' })
    const list = screen.getByRole('list', { name: 'Job history' })
    expect(list.tagName).toBe('UL')
    expect(list).toHaveAttribute('aria-labelledby', heading.id)
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    expect(document.querySelector('[data-slot="record-list-count"]')).toHaveTextContent('3')
    expect(document.querySelector('[data-slot="record-list-header"]')?.className).toContain('border-b')
    expect(root()).toHaveAttribute('data-variant', 'card')
    expect(root().className).toContain('border')
  })

  it('uses the requested heading level and ariaLabel for an untitled list', () => {
    const { unmount } = renderList({ ...recordListFixtures.childRecords, headingLevel: 2 })
    expect(screen.getByRole('heading', { level: 2, name: 'Job history' })).toBeInTheDocument()
    unmount()
    renderList(recordListFixtures.plain)
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Job history' })).toBeInTheDocument()
    expect(root().className).not.toContain('border-border bg-card')
  })

  it('renders title, subtitle, meta, trailing value and badge of a standard row', () => {
    renderList(recordListFixtures.recentRecords)
    const first = rows()[0]
    expect(within(first).getByRole('link', { name: 'Order 1042' })).toHaveAttribute('href', '#order-1042')
    expect(within(first).getByText('Lena Brandt')).toBeInTheDocument()
    expect(first.querySelector('[data-slot="record-list-item-meta"]')).toHaveTextContent('12 Mar 2026')
    expect(first.querySelector('[data-slot="record-list-item-trailing"]')).toHaveTextContent('1,240.00 EUR')
    expect(within(first).getByText('Paid')).toBeInTheDocument()
    expect(first.querySelector('[data-slot="record-list-item-leading"]')).toBeNull()
    expect(first.querySelector('[data-slot="record-list-item-chevron"]')).not.toBeNull()
  })

  it('joins subtitle and meta into one muted line with a comma', () => {
    renderList(recordListFixtures.recentRecords)
    const secondary = rows()[0].querySelector('[data-slot="record-list-item-secondary"]')
    expect(secondary).toHaveTextContent('Lena Brandt, 12 Mar 2026')
    expect(secondary?.textContent).not.toContain('\u00b7')
  })

  it('shows a status as a dot with text and not as a filled badge', () => {
    renderList(recordListFixtures.recentRecords)
    const badge = rows()[0].querySelector('[data-slot="record-list-item-badge"]') as HTMLElement
    expect(badge).toHaveAttribute('data-tone', 'success')
    expect(badge.className).not.toContain('bg-')
    expect(badge.className).not.toContain('border')
    expect(badge.querySelector('[aria-hidden="true"]')?.className).toContain('bg-status-success-icon')
  })

  it('shows up to three badges and sums up the rest', () => {
    renderList(recordListFixtures.descriptionAndBadges)
    const second = rows()[1]
    expect(second.querySelectorAll('[data-slot="record-list-item-badge"]')).toHaveLength(3)
    const more = second.querySelector('[data-slot="record-list-item-badges-more"]') as HTMLElement
    expect(more).toHaveTextContent('+2')
    expect(more).toHaveTextContent('2 more: Credit check passed, Tender')
    expect(rows()[0].querySelector('[data-slot="record-list-item-badges-more"]')).toBeNull()
  })

  it('renders the description as a clamped second muted line', () => {
    renderList(recordListFixtures.descriptionAndBadges)
    const description = rows()[0].querySelector('[data-slot="record-list-item-description"]') as HTMLElement
    expect(description).toHaveTextContent('Second chamber for the northern site.')
    expect(description.className).toContain('line-clamp-2')
  })

  it('renders an avatar with initials or an image for people and companies', () => {
    const { unmount } = renderList(recordListFixtures.people)
    const avatar = within(rows()[0]).getByRole('img', { name: 'Lena Brandt' })
    expect(avatar).toHaveTextContent('LB')
    unmount()
    renderList({ title: 'People', items: [{ id: 'person-1', title: 'Lena Brandt', avatarLabel: 'Lena Brandt', avatarUrl: '/avatars/lena.png' }] })
    expect(document.querySelector('[data-slot="record-list-item-leading"] img')).toHaveAttribute('src', '/avatars/lena.png')
  })

  it('renders a bare icon without a circle and keeps rows aligned when one row has no visual', () => {
    renderList({
      title: 'Claims',
      items: [
        { id: 'claim-1', title: 'Missing mounting kit', icon: 'shield-check' },
        { id: 'claim-2', title: 'Scratched panel' },
      ],
    })
    const leading = rows()[0].querySelector('[data-slot="record-list-item-leading"]') as HTMLElement
    expect(leading.className).not.toContain('rounded-full')
    expect(leading.className).not.toContain('bg-')
    expect(leading.querySelector('svg')).not.toBeNull()
    expect(rows()[1].querySelector('[data-slot="record-list-item-leading"]')).toBeNull()
    expect(rows()[1].firstElementChild).toHaveAttribute('aria-hidden', 'true')
    expect(rows()[1].firstElementChild?.className).toBe(leading.className)
  })

  it('shows a chevron only on rows that open something', () => {
    renderList({ title: 'Jobs', items: [{ id: 'job-1', title: 'Picker', href: '/jobs/1' }, { id: 'job-2', title: 'Packer' }] })
    expect(rows()[0]).toHaveAttribute('data-interactive', 'true')
    expect(rows()[0].className).toContain('hover:bg-muted')
    expect(rows()[0].querySelector('[data-slot="record-list-item-chevron"] svg')).not.toBeNull()
    expect(rows()[1].querySelector('[data-slot="record-list-item-chevron"]')).toBeNull()
    expect(rows()[1].className).not.toContain('hover:bg-muted')
  })

  it('reveals row actions on hover and focus and keeps them visible on touch and while the menu is open', () => {
    renderList(recordListFixtures.childRecords)
    const actions = rows()[0].querySelector('[data-slot="record-list-item-actions"]') as HTMLElement
    expect(actions.className).toContain('sm:pointer-fine:opacity-0')
    expect(actions.className).toContain('sm:pointer-fine:group-hover/row:opacity-100')
    expect(actions.className).toContain('sm:pointer-fine:group-focus-within/row:opacity-100')
    fireEvent.click(within(rows()[0]).getByRole('button', { name: 'Actions for Warehouse team lead' }))
    expect(actions.className).not.toContain('opacity-0')
  })

  it('calls onItemClick from the row button and from the keyboard', () => {
    const onItemClick = jest.fn()
    renderList({ ...recordListFixtures.childRecords, onItemClick })
    const target = screen.getByRole('button', { name: 'Warehouse team lead' })
    expect(target.className).toContain('after:absolute')
    fireEvent.click(target)
    expect(onItemClick).toHaveBeenCalledWith('job-1')
    target.focus()
    expect(document.activeElement).toBe(target)
  })

  it('keeps a real link for items with href and hands plain clicks to onItemClick', () => {
    const onItemClick = jest.fn()
    renderList({ ...recordListFixtures.recentRecords, onItemClick })
    const link = screen.getByRole('link', { name: 'Order 1042' })
    fireEvent.click(link, { ctrlKey: true })
    expect(onItemClick).not.toHaveBeenCalled()
    fireEvent.click(link)
    expect(onItemClick).toHaveBeenCalledWith('order-1042')
  })

  it('renders plain text when a row has neither href nor onItemClick', () => {
    renderList({ title: 'Jobs', items: [{ id: 'job-1', title: 'Picker' }] })
    expect(screen.queryByRole('button', { name: 'Picker' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('Picker')).toBeInTheDocument()
  })

  it('shows one inline icon action and moves the rest, destructive included, into the menu', () => {
    const onItemAction = jest.fn()
    const onItemClick = jest.fn()
    renderList({ ...recordListFixtures.childRecords, onItemAction, onItemClick })
    const first = rows()[0]
    const inline = first.querySelectorAll('[data-slot="record-list-item-action"]')
    expect(inline).toHaveLength(1)
    expect(inline[0]).toHaveAttribute('aria-label', 'Edit: Warehouse team lead')
    expect(inline[0]).toHaveAttribute('data-action-key', 'edit')
    fireEvent.click(inline[0])
    expect(onItemAction).toHaveBeenCalledWith('job-1', 'edit')
    expect(onItemClick).not.toHaveBeenCalled()
    expect(within(first).getByRole('button', { name: 'Actions for Warehouse team lead' })).toBeInTheDocument()
  })

  it('keeps a destructive only action out of the inline slot', () => {
    renderList({
      title: 'Jobs',
      onItemAction: () => undefined,
      items: [{ id: 'job-1', title: 'Picker', actions: [{ key: 'delete', label: 'Delete', icon: 'trash-2', tone: 'destructive' }] }],
    })
    expect(document.querySelector('[data-slot="record-list-item-action"]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Actions for Picker' })).toBeInTheDocument()
  })

  it('marks an inline action busy while its promise is pending', async () => {
    const pending = deferred()
    renderList({ ...recordListFixtures.linkedRecords, onItemAction: () => pending.promise })
    const action = screen.getByRole('button', { name: 'Unlink: Harbor Logistics' })
    fireEvent.click(action)
    expect(action).toHaveAttribute('aria-busy', 'true')
    expect(action).toBeDisabled()
    await act(async () => {
      pending.resolve()
      await pending.promise
    })
    expect(action).not.toHaveAttribute('aria-busy')
  })

  it('disables the click target and the actions of a disabled item', () => {
    const onItemClick = jest.fn()
    renderList({
      title: 'Jobs',
      onItemClick,
      onItemAction: () => undefined,
      items: [{ id: 'job-1', title: 'Picker', disabled: true, actions: [{ key: 'edit', label: 'Edit', icon: 'pencil-line' }] }],
    })
    expect(rows()[0]).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByRole('button', { name: 'Picker' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit: Picker' })).toBeDisabled()
  })

  it('runs onAdd from the header and renders a link when the add action has href', () => {
    const onAdd = jest.fn()
    const { unmount } = renderList({ ...recordListFixtures.childRecords, onAdd })
    fireEvent.click(screen.getByRole('button', { name: 'Add position' }))
    expect(onAdd).toHaveBeenCalledTimes(1)
    unmount()
    renderList({ title: 'Jobs', items: [{ id: 'job-1', title: 'Picker' }], addAction: { label: 'Add position', href: '/jobs/new' } })
    expect(screen.getByRole('link', { name: 'Add position' })).toHaveAttribute('href', '/jobs/new')
  })

  it('keeps a blocked add action focusable and described by its reason', () => {
    const onAdd = jest.fn()
    renderList({
      ...recordListFixtures.childRecords,
      onAdd,
      addAction: { label: 'Add position', disabled: true, disabledReason: 'Save the team member first' },
    })
    const button = screen.getByRole('button', { name: 'Add position' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    expect(button).toHaveAccessibleDescription('Save the team member first')
    expect(button.querySelector('[data-slot="record-list-add-label"]')?.className).toContain('@md:not-sr-only')
    fireEvent.click(button)
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('replaces the row body through renderItem and keeps the row target and actions', () => {
    const onItemClick = jest.fn()
    renderList({
      ...recordListFixtures.childRecords,
      onItemClick,
      renderItem: (item) => <span data-testid={`custom-${item.id}`}>{item.title.toUpperCase()}</span>,
    })
    expect(screen.getByTestId('custom-job-1')).toHaveTextContent('WAREHOUSE TEAM LEAD')
    expect(rows()[0].querySelector('[data-slot="record-list-item-leading"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Warehouse team lead' }))
    expect(onItemClick).toHaveBeenCalledWith('job-1')
    expect(screen.getByRole('button', { name: 'Edit: Warehouse team lead' })).toBeInTheDocument()
  })

  it('caps the rows and calls onShowAll with the total in the label', () => {
    const onShowAll = jest.fn()
    renderList({ ...recordListFixtures.capped, onShowAll })
    expect(rows()).toHaveLength(3)
    expect(document.querySelector('[data-slot="record-list-count"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show all 28' }))
    expect(onShowAll).toHaveBeenCalledTimes(1)
    expect(rows()).toHaveLength(3)
  })

  it('expands in place when capped without onShowAll and hides the control when nothing is hidden', () => {
    const { unmount } = renderList({ title: 'Recent orders', items: recordListFixtures.recentRecords.items, maxItems: 2 })
    expect(rows()).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Show all 4' }))
    expect(rows()).toHaveLength(4)
    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument()
    unmount()
    renderList({ title: 'Recent orders', items: recordListFixtures.recentRecords.items, maxItems: 10 })
    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument()
  })

  it('draws Show all as a full width row with a chevron', () => {
    renderList(recordListFixtures.capped)
    const control = screen.getByRole('button', { name: 'Show all 28' })
    expect(control.className).toContain('w-full')
    expect(control.querySelector('svg')).not.toBeNull()
  })

  it('uses a custom show all label', () => {
    renderList({ ...recordListFixtures.capped, showAllLabel: 'Open all orders' })
    expect(screen.getByRole('button', { name: 'Open all orders' })).toBeInTheDocument()
  })

  it('renders the cards layout and compact density as data attributes on the root', () => {
    const { unmount } = renderList(recordListFixtures.cards)
    expect(root()).toHaveAttribute('data-layout', 'cards')
    expect(screen.getByRole('list').className).toContain('grid')
    unmount()
    renderList(recordListFixtures.compact)
    expect(root()).toHaveAttribute('data-density', 'compact')
  })

  it('renders a skeleton and marks the block busy while loading', () => {
    renderList(recordListFixtures.loading)
    expect(root()).toHaveAttribute('aria-busy', 'true')
    expect(document.querySelector('[data-slot="record-list-skeleton"]')).not.toBeNull()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'People' })).toBeInTheDocument()
    expect(document.querySelectorAll('[data-slot="record-list-skeleton-row"]')).toHaveLength(4)
  })

  it('shapes the skeleton after the items when they are passed while loading', () => {
    renderList({ ...recordListFixtures.people, status: 'loading' })
    expect(document.querySelectorAll('[data-slot="record-list-skeleton-row"]')).toHaveLength(4)
    expect(document.querySelector('[data-slot="record-list-add"]')).not.toBeNull()
  })

  it('renders the error without a frame and retries', () => {
    const onRetry = jest.fn()
    renderList({ ...recordListFixtures.error, onRetry })
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load job history')
    expect(root().className).not.toContain('bg-card')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('falls back to the default error message', () => {
    renderList({ title: 'Jobs', items: [], status: 'error' })
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the list')
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('shows the empty state with the add action once, inside the empty state', () => {
    const onAdd = jest.fn()
    renderList({ ...recordListFixtures.empty, onAdd })
    expect(screen.getByText('No positions yet')).toBeInTheDocument()
    expect(screen.getByText('Add the first position to start the job history.')).toBeInTheDocument()
    const addButtons = screen.getAllByRole('button', { name: 'Add position' })
    expect(addButtons).toHaveLength(1)
    expect(document.querySelector('[data-slot="record-list-empty"]')).toContainElement(addButtons[0])
    fireEvent.click(addButtons[0])
    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  it('uses default empty copy and honours the emptyState slot', () => {
    const { unmount } = renderList({ title: 'Jobs', items: [] })
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument()
    unmount()
    renderList({ title: 'Jobs', items: [], emptyState: <p>Custom empty</p> })
    expect(screen.getByText('Custom empty')).toBeInTheDocument()
    expect(screen.queryByText('Nothing here yet')).not.toBeInTheDocument()
  })

  it('moves the icon action into the menu when the block itself is narrow', () => {
    const original = globalThis.ResizeObserver
    let notify: (width: number) => void = () => undefined
    class FakeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        notify = (width) => callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver)
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver
    try {
      renderList(recordListFixtures.childRecords)
      expect(rows()[0].querySelectorAll('[data-slot="record-list-item-action"]')).toHaveLength(1)
      act(() => notify(326))
      expect(rows()[0].querySelector('[data-slot="record-list-item-action"]')).toBeNull()
      expect(within(rows()[0]).getByRole('button', { name: 'Actions for Warehouse team lead' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Add position' })).toBeInTheDocument()
      act(() => notify(640))
      expect(rows()[0].querySelectorAll('[data-slot="record-list-item-action"]')).toHaveLength(1)
    } finally {
      globalThis.ResizeObserver = original
    }
  })

  it('treats status empty as empty even when items are passed', () => {
    renderList({ ...recordListFixtures.childRecords, status: 'empty' })
    expect(rows()).toHaveLength(0)
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument()
  })
})
