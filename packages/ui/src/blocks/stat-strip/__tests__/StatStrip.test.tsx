import * as React from 'react'
import { fireEvent, screen, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { StatStrip } from '../StatStrip'
import { statStripFixtures } from '../fixtures'
import { statStripPropsSchema, type StatStripProps } from '../../contracts/stat-strip'

const dict = {
  ui: {
    blocks: {
      statStrip: {
        label: 'Key figures',
        loading: 'Loading',
        error: 'Could not load the figures',
        retry: 'Try again',
        empty: 'No figures yet',
        emptyDescription: 'Figures will appear here once there is data to count.',
        deltaUp: 'up {label}',
        deltaDown: 'down {label}',
        deltaFlat: 'no change, {label}',
      },
    },
  },
}

function renderStrip(props: StatStripProps) {
  return renderWithProviders(<StatStrip {...props} />, { dict })
}

function root() {
  return document.querySelector('[data-slot="stat-strip"]') as HTMLElement
}

function tile(itemId: string) {
  return document.querySelector(`[data-slot="stat-strip-tile"][data-item-id="${itemId}"]`) as HTMLElement
}

describe('StatStrip', () => {
  it('keeps every fixture valid against the contract', () => {
    for (const [name, fixture] of Object.entries(statStripFixtures)) {
      const result = statStripPropsSchema.safeParse(fixture)
      expect({ name, success: result.success }).toEqual({ name, success: true })
    }
  })

  it('renders a labelled group with one list item per figure', () => {
    renderStrip(statStripFixtures.captions)
    const group = screen.getByRole('group', { name: 'Sales summary' })
    const tiles = within(group).getAllByRole('listitem')
    expect(tiles).toHaveLength(4)
    expect(within(tiles[1]).getByText('Revenue')).toBeInTheDocument()
    expect(within(tiles[1]).getByText(/^48\s200\.00 EUR$/)).toHaveClass('tabular-nums')
    expect(within(tiles[1]).getByText('Last 30 days')).toBeInTheDocument()
  })

  it('falls back to a translated group label', () => {
    renderStrip({ items: statStripFixtures.captions.items })
    expect(screen.getByRole('group', { name: 'Key figures' })).toBeInTheDocument()
  })

  it('renders plain tiles without buttons or links', () => {
    renderStrip(statStripFixtures.captions)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
    expect(tile('revenue').tagName).toBe('DIV')
  })

  it('draws one frame for the card variant and none for the plain variant', () => {
    const { unmount } = renderStrip(statStripFixtures.captions)
    expect(root()).toHaveAttribute('data-variant', 'card')
    expect(root().className).toContain('border-border')
    expect(root().className).toContain('rounded-card')
    expect(tile('revenue').className).not.toContain('rounded-card')
    unmount()
    renderStrip(statStripFixtures.plain)
    expect(root()).toHaveAttribute('data-variant', 'plain')
    expect(root().className).not.toContain('border')
    expect(document.querySelector('li')?.className).not.toContain('border')
  })

  it('never frames a tile, selected or not', () => {
    renderStrip(statStripFixtures.filters)
    for (const element of Array.from(document.querySelectorAll('[data-slot="stat-strip-tile"]'))) {
      expect(element.className).not.toMatch(/\b(border|ring-\d|rounded-card)\b/)
    }
  })

  it('announces a change indicator with an icon, the text and a spoken phrase', () => {
    renderStrip(statStripFixtures.deltas)
    const up = tile('revenue').querySelector('[data-slot="stat-strip-delta"]') as HTMLElement
    expect(up).toHaveAttribute('data-direction', 'up')
    expect(up).toHaveAttribute('data-sentiment', 'positive')
    expect(up.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(within(up).getByText('12%')).toHaveAttribute('aria-hidden', 'true')
    expect(within(up).getByText('up 12%')).toHaveClass('sr-only')
    expect(up.className).toContain('bg-status-success-bg')
    expect(up.className).toContain('text-status-success-text')

    const upBad = tile('refunds').querySelector('[data-slot="stat-strip-delta"]') as HTMLElement
    expect(upBad).toHaveAttribute('data-sentiment', 'negative')
    expect(upBad.className).toContain('bg-status-error-bg')

    const down = tile('response-time').querySelector('[data-slot="stat-strip-delta"]') as HTMLElement
    expect(within(down).getByText('down 25 min')).toBeInTheDocument()

    const flat = tile('win-rate').querySelector('[data-slot="stat-strip-delta"]') as HTMLElement
    expect(flat).toHaveAttribute('data-sentiment', 'neutral')
    expect(within(flat).getByText('no change, 0 pts')).toBeInTheDocument()
    expect(flat.className).toContain('bg-muted')
  })

  it('draws a trend as a decorative line coloured by the change indicator', () => {
    renderStrip(statStripFixtures.trends)
    const rising = tile('revenue').querySelector('[data-slot="stat-strip-trend"]') as HTMLElement
    expect(rising).toHaveAttribute('aria-hidden', 'true')
    expect(rising).toHaveAttribute('data-sentiment', 'positive')
    expect(rising.className).toContain('text-status-success-icon')
    const line = rising.querySelector('polyline') as SVGPolylineElement
    expect(line.getAttribute('points')?.split(' ')).toHaveLength(12)
    expect(line.getAttribute('stroke')).toBe('currentColor')
    expect(line.getAttribute('stroke-width')).toBe('1.5')
    const lastPoint = line.getAttribute('points')?.split(' ').pop()?.split(',')
    const marker = rising.querySelector('circle') as SVGCircleElement
    expect([marker.getAttribute('cx'), marker.getAttribute('cy')]).toEqual(lastPoint)
    expect(tile('refund-rate').querySelector('[data-slot="stat-strip-trend"]')?.className).toContain('text-status-error-icon')
    expect(tile('basket').querySelector('[data-slot="stat-strip-trend"]')?.className).toContain('text-muted-foreground')
    expect(tile('revenue').querySelector('[data-slot="stat-strip-delta"] .sr-only')).toHaveTextContent('up 12%')
  })

  it('keeps a flat trend on the middle line and leaves tiles without a trend alone', () => {
    renderStrip({ items: [{ id: 'flat', label: 'Flat', value: '5', trend: [5, 5, 5] }, { id: 'none', label: 'None', value: '1' }] })
    const points = tile('flat').querySelector('polyline')?.getAttribute('points')?.split(' ') ?? []
    expect(points.map((point) => point.split(',')[1])).toEqual(['12', '12', '12'])
    expect(tile('none').querySelector('[data-slot="stat-strip-trend"]')).toBeNull()
  })

  it('renders tiles as buttons when onItemClick is set and marks the selected one', () => {
    const onItemClick = jest.fn()
    renderStrip({ ...statStripFixtures.filters, onItemClick })
    const open = screen.getByRole('button', { name: /Open 38/ })
    expect(open).toHaveAttribute('aria-pressed', 'true')
    const all = screen.getByRole('button', { name: /All claims/ })
    expect(all).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(all)
    expect(onItemClick).toHaveBeenCalledWith('all')
  })

  it('marks the selected tile with a fill, an accent bar and a foreground label instead of a box', () => {
    renderStrip(statStripFixtures.filters)
    const open = tile('open')
    expect(open).toHaveAttribute('data-selected', 'true')
    expect(open.className).toContain('bg-accent-indigo/10')
    expect(open.querySelector('[data-slot="stat-strip-selected-bar"]')?.className).toContain('bg-accent-indigo')
    expect(open.querySelector('[data-slot="stat-strip-label"]')?.className).toContain('text-foreground')
    const all = tile('all')
    expect(all.querySelector('[data-slot="stat-strip-selected-bar"]')).toBeNull()
    expect(all.querySelector('[data-slot="stat-strip-label"]')?.className).toContain('text-muted-foreground')
  })

  it('shows a hover fill, a pointer and an arrow cue only on clickable tiles', () => {
    renderStrip(statStripFixtures.filters)
    const all = tile('all')
    expect(all).toHaveAttribute('data-interactive', 'true')
    expect(all.className).toContain('cursor-pointer')
    expect(all.className).toContain('hover:bg-muted/60')
    const cue = all.querySelector('[data-slot="stat-strip-cue"]') as SVGElement
    expect(cue).toHaveAttribute('aria-hidden', 'true')
    expect(cue.getAttribute('class')).toContain('group-hover/tile:opacity-100')
    expect(cue.getAttribute('class')).toContain('group-focus-visible/tile:opacity-100')
    const plain = tile('handling-time')
    expect(plain.tagName).toBe('DIV')
    expect(plain).not.toHaveAttribute('data-interactive')
    expect(plain.querySelector('[data-slot="stat-strip-cue"]')).toBeNull()
    expect(screen.queryByRole('button', { name: /Average handling time/ })).toBeNull()
  })

  it('keeps button tiles in the tab order and activates them from the keyboard', () => {
    const onItemClick = jest.fn()
    renderStrip({ ...statStripFixtures.filters, onItemClick })
    const overdue = screen.getByRole('button', { name: /Overdue/ })
    overdue.focus()
    expect(overdue).toHaveFocus()
    expect(overdue).toHaveAttribute('type', 'button')
    expect(overdue.className).toContain('outline-none')
    expect(overdue.innerHTML).toContain('group-focus-visible/tile:shadow-focus')
    expect(root().querySelector('[data-item-id="overdue"] .inset-1')).not.toBeNull()
    fireEvent.click(overdue, { detail: 0 })
    expect(onItemClick).toHaveBeenCalledWith('overdue')
  })

  it('does not fire for a disabled tile', () => {
    const onItemClick = jest.fn()
    renderStrip({ ...statStripFixtures.filters, onItemClick })
    const archived = screen.getByRole('button', { name: /Archived/ })
    expect(archived).toBeDisabled()
    fireEvent.click(archived)
    expect(onItemClick).not.toHaveBeenCalled()
  })

  it('renders tiles with href as links and marks the current one', () => {
    renderStrip({ ...statStripFixtures.links, selectedId: 'revenue' })
    const link = screen.getByRole('link', { name: /Revenue/ })
    expect(link).toHaveAttribute('href', '/backend/reports/revenue')
    expect(link).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('link', { name: /Returns/ })).not.toHaveAttribute('aria-current')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('hands a plain click on a link tile to onItemClick and leaves modified clicks to the browser', () => {
    const onItemClick = jest.fn()
    renderStrip({ ...statStripFixtures.links, onItemClick })
    const link = screen.getByRole('link', { name: /Revenue/ })
    expect(fireEvent.click(link)).toBe(false)
    expect(onItemClick).toHaveBeenCalledWith('revenue')
    onItemClick.mockClear()
    link.addEventListener('click', (event) => event.preventDefault())
    fireEvent.click(link, { metaKey: true })
    expect(onItemClick).not.toHaveBeenCalled()
  })

  it('renders a disabled link tile as plain content', () => {
    renderStrip({ items: [{ id: 'revenue', label: 'Revenue', value: '10', href: '/reports', disabled: true }] })
    expect(screen.queryByRole('link')).toBeNull()
    expect(tile('revenue')).toHaveAttribute('aria-disabled', 'true')
  })

  it('renders a tile action as a quiet link and keeps the tile itself plain', () => {
    const onItemAction = jest.fn()
    renderStrip({ ...statStripFixtures.actions, onItemAction, onItemClick: jest.fn() })
    expect(tile('on-hand').tagName).toBe('DIV')
    expect(screen.queryByRole('button')).not.toBeNull()
    expect(screen.queryByRole('button', { name: /On hand/ })).toBeNull()
    const link = screen.getByRole('link', { name: 'View stock' })
    expect(link).toHaveAttribute('href', '/backend/inventory/stock')
    expect(link.className).toContain('focus-visible:shadow-focus')
    expect(fireEvent.click(link)).toBe(false)
    expect(onItemAction).toHaveBeenCalledWith('on-hand')
    onItemAction.mockClear()
    link.addEventListener('click', (event) => event.preventDefault())
    fireEvent.click(link, { ctrlKey: true })
    expect(onItemAction).not.toHaveBeenCalled()
    expect(tile('reorder-point').querySelector('[data-slot="stat-strip-action"]')).toBeNull()
  })

  it('renders an action without href as a button', () => {
    const onItemAction = jest.fn()
    renderStrip({ ...statStripFixtures.long, onItemAction })
    const action = screen.getByRole('button', { name: 'Open the pipeline board' })
    expect(action).toHaveAttribute('type', 'button')
    fireEvent.click(action)
    expect(onItemAction).toHaveBeenCalledWith('deals')
  })

  it('renders icons as decoration and badges as text', () => {
    const { unmount } = renderStrip(statStripFixtures.icons)
    const icon = tile('out-of-stock').querySelector('[data-slot="stat-strip-label"] svg') as SVGElement
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(icon.getAttribute('class')).toContain('text-status-error-icon')
    expect(tile('out-of-stock').querySelector('[data-slot="stat-strip-tone"]')).toBeNull()
    unmount()
    renderStrip(statStripFixtures.badges)
    expect(within(tile('on-hand').querySelector('[data-slot="stat-strip-badge"]') as HTMLElement).getByText('Healthy')).toBeInTheDocument()
  })

  it('shows a tone as a dot before the label and never recolours the figure', () => {
    renderStrip(statStripFixtures.filters)
    const dot = tile('overdue').querySelector('[data-slot="stat-strip-tone"]') as HTMLElement
    expect(dot).toHaveAttribute('data-tone', 'error')
    expect(dot).toHaveAttribute('aria-hidden', 'true')
    expect(dot.className).toContain('bg-status-error-icon')
    expect(tile('all').querySelector('[data-slot="stat-strip-tone"]')).toBeNull()
    for (const value of Array.from(document.querySelectorAll('[data-slot="stat-strip-value"]'))) {
      expect(value.className).toContain('text-foreground')
      expect(value.className).not.toContain('status')
    }
  })

  it('skips an unknown icon name without failing', () => {
    renderStrip({ items: [{ id: 'one', label: 'One', value: '1', icon: 'not-a-registered-icon' }] })
    expect(tile('one').querySelector('svg')).toBeNull()
  })

  it('fits columns to the number of tiles and honours an explicit count', () => {
    const list = () => document.querySelector('[data-slot="stat-strip-list"]') as HTMLElement
    const { unmount } = renderStrip(statStripFixtures.six)
    expect(list().className).toContain('@6xl:grid-cols-6')
    expect(list().className).toContain('@3xs:grid-cols-2')
    unmount()
    const second = renderStrip({ ...statStripFixtures.six, columns: 3 })
    expect(list().className).toContain('@xl:grid-cols-3')
    expect(list().className).not.toContain('grid-cols-6')
    second.unmount()
    renderStrip({ items: statStripFixtures.badges.items })
    const cells = document.querySelectorAll('li')
    expect(cells[2].className).toContain('@3xs:col-span-2')
    expect(cells[2].className).toContain('@xl:col-span-1')
    expect(cells[0].className).not.toContain('col-span-2')
  })

  it('stretches the last tile so a wrapped row never leaves a hole', () => {
    const { unmount } = renderStrip(statStripFixtures.filters)
    const five = document.querySelectorAll('li')
    expect(five[4].className).toContain('@3xs:col-span-2')
    expect(five[4].className).toContain('@xl:col-span-2')
    expect(five[4].className).toContain('@5xl:col-span-1')
    unmount()
    renderStrip({ ...statStripFixtures.six, items: statStripFixtures.six.items.slice(0, 5), columns: 4 })
    const wrapped = document.querySelectorAll('li')
    expect(wrapped[4].className).toContain('@3xl:col-span-4')
    expect(wrapped[3].className).not.toContain('col-span')
  })

  it('applies the size', () => {
    const { unmount } = renderStrip(statStripFixtures.compact)
    expect(root()).toHaveAttribute('data-size', 'compact')
    expect(tile('revenue').querySelector('[data-slot="stat-strip-value"]')?.className).not.toContain('text-2xl')
    unmount()
    renderStrip(statStripFixtures.deltas)
    const value = tile('revenue').querySelector('[data-slot="stat-strip-value"]')
    expect(value?.className).toContain('@sm:text-2xl')
    expect(value?.className).toContain('@4xl:text-3xl')
  })

  it('never uses font weight for hierarchy', () => {
    renderStrip(statStripFixtures.trends)
    expect(root().innerHTML).not.toMatch(/font-(medium|semibold|bold)/)
  })

  it('shows skeleton tiles while loading', () => {
    renderStrip({ items: [], status: 'loading', skeletonCount: 5 })
    expect(root()).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Loading')).toHaveClass('sr-only')
    expect(document.querySelectorAll('[data-slot="stat-strip-skeleton-tile"]')).toHaveLength(5)
    expect(screen.queryByRole('group')).toBeNull()
  })

  it('uses the item count, then four, for the skeleton when no count is given', () => {
    const { unmount } = renderStrip({ items: statStripFixtures.badges.items, status: 'loading' })
    expect(document.querySelectorAll('[data-slot="stat-strip-skeleton-tile"]')).toHaveLength(3)
    unmount()
    renderStrip({ items: [], status: 'loading' })
    expect(document.querySelectorAll('[data-slot="stat-strip-skeleton-tile"]')).toHaveLength(4)
  })

  it('shows the error with a retry action', () => {
    const onRetry = jest.fn()
    renderStrip({ items: [], status: 'error', errorMessage: 'Could not load the sales figures', onRetry })
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the sales figures')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('shows a default error without a retry button when onRetry is missing', () => {
    renderStrip({ items: [], status: 'error' })
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the figures')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows the empty state for an empty status or an empty list', () => {
    const { unmount } = renderStrip({ items: [], status: 'empty' })
    expect(screen.getByText('No figures yet')).toBeInTheDocument()
    unmount()
    renderStrip({ items: [] })
    expect(screen.getByText('Figures will appear here once there is data to count.')).toBeInTheDocument()
  })

  it('renders the emptyState slot instead of the default empty state', () => {
    renderStrip({ items: [], emptyState: <p>Connect a sales channel to see figures</p> })
    expect(screen.getByText('Connect a sales channel to see figures')).toBeInTheDocument()
    expect(screen.queryByText('No figures yet')).toBeNull()
  })
})
