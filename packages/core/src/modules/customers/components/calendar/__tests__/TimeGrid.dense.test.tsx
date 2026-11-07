/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { TimeGrid } from '../TimeGrid'
import type { CalendarItem } from '../types'
import { buildCalendarItem } from './fixtures'

const anchor = new Date(2026, 9, 13)

const dict = {
  'customers.calendar.grid.more': '+{count} more',
  'customers.calendar.grid.overflowAria': '{count} more events, {range}',
  'customers.calendar.grid.overflowTitle': '{count} overlapping events',
}

const DENSE_TITLES = ['Alpha sync', 'Bravo review', 'Charlie demo', 'Delta call', 'Echo standup', 'Foxtrot retro']

function at(hours: number, minutes = 0): Date {
  return new Date(2026, 9, 13, hours, minutes, 0, 0)
}

function denseItems(): CalendarItem[] {
  return DENSE_TITLES.map((title, index) =>
    buildCalendarItem({ id: `dense-${index}`, title, start: at(10), end: at(11) }),
  )
}

function installColumnWidth(widthPx: number) {
  // TimeGrid measures synchronously before observing, so the stub never needs
  // to fire; Radix also instantiates one for popover positioning.
  class FakeResizeObserver {
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, writable: true, value: FakeResizeObserver })
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    width: widthPx,
    height: 0,
    top: 0,
    left: 0,
    right: widthPx,
    bottom: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }))
}

function renderGrid(items: CalendarItem[], onItemClick = jest.fn(), canManage = true) {
  const utils = renderWithProviders(
    <TimeGrid
      anchor={anchor}
      days={1}
      items={items}
      showWeekends
      showConflicts={false}
      aiSummaries={false}
      canManage={canManage}
      conflictIds={new Set()}
      onItemClick={onItemClick}
      onJoin={() => {}}
      onNavigate={() => {}}
    />,
    { dict },
  )
  return { ...utils, onItemClick }
}

function gridBlock(title: string) {
  return screen.queryByRole('button', { name: new RegExp(`^${title}, `) })
}

afterEach(() => {
  jest.restoreAllMocks()
  Reflect.deleteProperty(globalThis, 'ResizeObserver')
})

describe('TimeGrid dense overlaps (#7500)', () => {
  it('collapses six simultaneous meetings into readable blocks plus an overflow disclosure at week-column width', () => {
    installColumnWidth(170)
    renderGrid(denseItems())

    expect(gridBlock('Alpha sync')).toBeInTheDocument()
    for (const title of DENSE_TITLES.slice(1)) {
      expect(gridBlock(title)).not.toBeInTheDocument()
    }
    const overflow = screen.getByRole('button', { name: /^5 more events, / })
    expect(overflow).toHaveTextContent('+5 more')
    overflow.focus()
    expect(document.activeElement).toBe(overflow)
  })

  it('lists every hidden meeting with its full title and time range and opens the editor from a row', () => {
    installColumnWidth(170)
    const { onItemClick } = renderGrid(denseItems())

    fireEvent.click(screen.getByRole('button', { name: /^5 more events, / }))
    expect(screen.getByText('5 overlapping events')).toBeInTheDocument()
    const list = screen.getByRole('list')
    const rows = within(list).getAllByRole('button')
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual(
      DENSE_TITLES.slice(1).map((title) => expect.stringMatching(new RegExp(`^${title}, .*10:00.*11:00`))),
    )
    expect(within(list).getByText('Charlie demo')).toBeInTheDocument()

    fireEvent.click(within(list).getByRole('button', { name: /^Charlie demo, / }))
    expect(onItemClick).toHaveBeenCalledTimes(1)
    expect(onItemClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'dense-2', title: 'Charlie demo' }))
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('lets a viewer open the peek of a hidden meeting by pointer and keyboard, without editing', async () => {
    installColumnWidth(170)
    const user = userEvent.setup()
    const { onItemClick } = renderGrid(denseItems(), jest.fn(), false)

    await user.click(screen.getByRole('button', { name: /^5 more events, / }))
    const list = screen.getByRole('list')

    await user.click(within(list).getByRole('button', { name: /^Charlie demo, / }))
    const peekEdit = await screen.findByRole('button', { name: 'Edit' })
    expect(peekEdit).toBeDisabled()
    expect(screen.getAllByText('Charlie demo').length).toBeGreaterThan(1)
    expect(onItemClick).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument())

    const row = within(screen.getByRole('list')).getByRole('button', { name: /^Delta call, / })
    row.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeDisabled()
    expect(screen.getAllByText('Delta call').length).toBeGreaterThan(1)
    expect(onItemClick).not.toHaveBeenCalled()
  })

  it('closes the overflow list and any peek when the grid scrolls', () => {
    installColumnWidth(170)
    const { container } = renderGrid(denseItems())

    fireEvent.click(screen.getByRole('button', { name: /^5 more events, / }))
    expect(screen.getByRole('list')).toBeInTheDocument()

    const scroller = container.querySelector('.overflow-auto')!
    scroller.scrollTop += 40
    fireEvent.scroll(scroller)
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('keeps the overflow list open when a scroll event arrives without any movement since it opened', () => {
    installColumnWidth(170)
    const { container } = renderGrid(denseItems())

    fireEvent.click(screen.getByRole('button', { name: /^5 more events, / }))
    fireEvent.scroll(container.querySelector('.overflow-auto')!)
    expect(screen.getByRole('list')).toBeInTheDocument()
  })

  it('keeps a peek open when the scroll that preceded the click is delivered after it', () => {
    installColumnWidth(600)
    const { container } = renderGrid([
      buildCalendarItem({ id: 'solo', title: 'Alpha sync', start: at(7), end: at(8) }),
    ])
    const scroller = container.querySelector('.overflow-auto')!
    scroller.scrollTop = 700

    fireEvent.click(screen.getByRole('button', { name: /^Alpha sync, / }))
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()

    fireEvent.scroll(scroller)
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()

    scroller.scrollTop = 760
    fireEvent.scroll(scroller)
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('keeps two overlapping meetings side by side without an overflow', () => {
    installColumnWidth(170)
    renderGrid([
      buildCalendarItem({ id: 'pair-1', title: 'Alpha sync', start: at(9), end: at(10, 30) }),
      buildCalendarItem({ id: 'pair-2', title: 'Bravo review', start: at(9, 30), end: at(11) }),
    ])
    expect(gridBlock('Alpha sync')).toBeInTheDocument()
    expect(gridBlock('Bravo review')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /more events/ })).not.toBeInTheDocument()
  })

  it('keeps two overlapping meetings visible in a narrow seven-day column', () => {
    installColumnWidth(126)
    renderGrid([
      buildCalendarItem({ id: 'pair-1', title: 'Alpha sync', start: at(9), end: at(10, 30) }),
      buildCalendarItem({ id: 'pair-2', title: 'Bravo review', start: at(9, 30), end: at(11) }),
    ])
    expect(gridBlock('Alpha sync')).toBeInTheDocument()
    expect(gridBlock('Bravo review')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /more events/ })).not.toBeInTheDocument()
  })

  it('keeps one meeting beside the overflow when a dense cluster lands in a narrow column', () => {
    installColumnWidth(126)
    renderGrid(denseItems())
    expect(gridBlock('Alpha sync')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^5 more events, / })).toHaveTextContent('+5 more')
  })

  it('tones the overflow per row and keeps the header neutral when the first hidden meeting is canceled', () => {
    installColumnWidth(170)
    renderGrid([
      buildCalendarItem({ id: 'tone-0', title: 'Alpha sync', start: at(10), end: at(12), status: 'planned' }),
      buildCalendarItem({ id: 'tone-1', title: 'Bravo review', start: at(10), end: at(12), status: 'canceled' }),
      buildCalendarItem({ id: 'tone-2', title: 'Charlie demo', start: at(10), end: at(12), status: 'planned' }),
    ])
    const overflow = screen.getByRole('button', { name: /^2 more events, / })
    expect(within(overflow).getByText('+2 more').className).not.toContain('line-through')
    expect(within(overflow).getByText('+2 more').className).toContain('text-foreground')
    expect(within(overflow).getByText('Bravo review').className).toContain('text-muted-foreground/70')
    expect(within(overflow).getByText('Charlie demo').className).not.toContain('text-muted-foreground/70')
  })

  it('shows every meeting as its own block once the column is wide enough', () => {
    installColumnWidth(600)
    renderGrid(denseItems())
    for (const title of DENSE_TITLES) {
      expect(gridBlock(title)).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: /more events/ })).not.toBeInTheDocument()
  })

  it('collapses partially overlapping and chained meetings while keeping disjoint ones visible', () => {
    installColumnWidth(170)
    renderGrid([
      buildCalendarItem({ id: 'chain-1', title: 'Alpha sync', start: at(9), end: at(12) }),
      buildCalendarItem({ id: 'chain-2', title: 'Bravo review', start: at(9, 30), end: at(10, 30) }),
      buildCalendarItem({ id: 'chain-3', title: 'Charlie demo', start: at(10), end: at(11) }),
      buildCalendarItem({ id: 'chain-4', title: 'Delta call', start: at(10, 15), end: at(11, 45) }),
      buildCalendarItem({ id: 'solo', title: 'Echo standup', start: at(14), end: at(15) }),
    ])
    expect(gridBlock('Alpha sync')).toBeInTheDocument()
    expect(gridBlock('Echo standup')).toBeInTheDocument()
    const overflow = screen.getByRole('button', { name: /^3 more events, / })
    fireEvent.click(overflow)
    const list = screen.getByRole('list')
    expect(within(list).getAllByRole('button').map((row) => row.getAttribute('aria-label'))).toEqual([
      expect.stringMatching(/^Bravo review, /),
      expect.stringMatching(/^Charlie demo, /),
      expect.stringMatching(/^Delta call, /),
    ])
  })

  it('counts conflicts hidden inside the overflow and flags the disclosure', () => {
    installColumnWidth(170)
    renderWithProviders(
      <TimeGrid
        anchor={anchor}
        days={1}
        items={denseItems()}
        showWeekends
        showConflicts
        aiSummaries={false}
        conflictIds={new Set(['dense-3', 'dense-4'])}
        onItemClick={() => {}}
        onJoin={() => {}}
        onNavigate={() => {}}
      />,
      { dict: { ...dict, 'customers.calendar.grid.conflictsCount': '{count} conflicts' } },
    )
    expect(screen.getByText('2 conflicts')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^5 more events, / }).className).toContain('ring-status-warning-icon')
  })
})
