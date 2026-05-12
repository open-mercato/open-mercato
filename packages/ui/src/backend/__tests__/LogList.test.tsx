/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { LogLevelBadge, LogList, type LogListEntry } from '../LogList'

function makeEntry(over: Partial<LogListEntry> = {}): LogListEntry {
  return {
    id: 'log-1',
    time: '2026-05-12 10:00',
    level: 'info',
    message: 'Sample log message',
    body: <div data-testid="body-1">Body of log-1</div>,
    ...over,
  }
}

describe('LogLevelBadge', () => {
  it('applies the info palette by default', () => {
    const { container } = render(<LogLevelBadge level="info" />)
    const badge = container.firstElementChild as HTMLElement
    expect(badge.className).toContain('bg-blue-100')
    expect(badge.className).toContain('text-blue-800')
  })

  it('maps warn / warning / error / debug to the matching palette', () => {
    const { rerender, container } = render(<LogLevelBadge level="warn" />)
    expect(container.firstElementChild!.className).toContain('bg-amber-100')

    rerender(<LogLevelBadge level="warning" />)
    expect(container.firstElementChild!.className).toContain('bg-amber-100')

    rerender(<LogLevelBadge level="error" />)
    expect(container.firstElementChild!.className).toContain('bg-red-100')

    rerender(<LogLevelBadge level="debug" />)
    expect(container.firstElementChild!.className).toContain('bg-zinc-100')
  })

  it('renders an unrecognized level without color classes (falls back to Badge defaults)', () => {
    const { container } = render(<LogLevelBadge level="custom-level" />)
    const badge = container.firstElementChild as HTMLElement
    expect(badge.className).not.toContain('bg-blue-100')
    expect(badge.className).not.toContain('bg-amber-100')
    expect(badge.className).not.toContain('bg-red-100')
    expect(badge.className).not.toContain('bg-zinc-100')
  })

  it('honors a custom label and falls back to level when label is omitted', () => {
    const { rerender } = render(<LogLevelBadge level="info" label="Information" />)
    expect(screen.getByText('Information')).toBeInTheDocument()

    rerender(<LogLevelBadge level="error" />)
    expect(screen.getByText('error')).toBeInTheDocument()
  })
})

describe('LogList', () => {
  it('renders the empty message when entries are empty', () => {
    render(<LogList entries={[]} emptyMessage="No log entries" />)
    expect(screen.getByText('No log entries')).toBeInTheDocument()
    expect(screen.getByText('No log entries').getAttribute('data-slot')).toBe('log-list-empty')
  })

  it('renders nothing when entries are empty and no empty message is provided', () => {
    const { container } = render(<LogList entries={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders one accordion item per entry with time / level / message in the trigger', () => {
    render(
      <LogList
        entries={[
          makeEntry({ id: 'a', time: '10:00', level: 'info', message: 'Connected' }),
          makeEntry({ id: 'b', time: '10:01', level: 'error', message: 'Timeout' }),
        ]}
      />,
    )
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.getByText('Timeout')).toBeInTheDocument()
    expect(screen.getByText('10:00')).toBeInTheDocument()
    expect(screen.getByText('10:01')).toBeInTheDocument()
    expect(screen.getByText('info')).toBeInTheDocument()
    expect(screen.getByText('error')).toBeInTheDocument()
  })

  it('forwards the entry id as data-log-entry-id on the AccordionItem', () => {
    const { container } = render(
      <LogList entries={[makeEntry({ id: 'log-42' })]} />,
    )
    expect(container.querySelector('[data-log-entry-id="log-42"]')).not.toBeNull()
  })

  it('hides each entry body until the trigger is clicked, then reveals it (single + collapsible)', () => {
    const { container } = render(
      <LogList
        entries={[
          makeEntry({ id: 'a', message: 'A' }),
          makeEntry({ id: 'b', message: 'B' }),
        ]}
      />,
    )
    const items = container.querySelectorAll('[data-slot="accordion-item"]')
    expect(items[0]).toHaveAttribute('data-state', 'closed')
    expect(items[1]).toHaveAttribute('data-state', 'closed')

    fireEvent.click(screen.getByRole('button', { name: /A/ }))
    expect(items[0]).toHaveAttribute('data-state', 'open')
    expect(items[1]).toHaveAttribute('data-state', 'closed')

    fireEvent.click(screen.getByRole('button', { name: /B/ }))
    expect(items[0]).toHaveAttribute('data-state', 'closed')
    expect(items[1]).toHaveAttribute('data-state', 'open')
  })

  it('uses the levelLabel override when provided (e.g. translated level text)', () => {
    render(
      <LogList
        entries={[
          makeEntry({ level: 'warn', levelLabel: 'Ostrzeżenie' }),
        ]}
      />,
    )
    expect(screen.getByText('Ostrzeżenie')).toBeInTheDocument()
    expect(screen.queryByText('warn')).toBeNull()
  })

  it('supports ReactNode message + body slots (not just strings); body mounts on expand', () => {
    render(
      <LogList
        entries={[
          {
            id: 'rich',
            time: <span data-testid="time">10:00:01</span>,
            level: 'info',
            message: <span data-testid="message">Detailed event</span>,
            body: <pre data-testid="body">JSON payload</pre>,
          },
        ]}
      />,
    )
    expect(screen.getByTestId('time')).toBeInTheDocument()
    expect(screen.getByTestId('message')).toBeInTheDocument()
    // Radix lazy-mounts AccordionContent children — body appears only after the trigger is opened.
    expect(screen.queryByTestId('body')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Detailed event/ }))
    expect(screen.getByTestId('body')).toBeInTheDocument()
  })

  it('marks the root with data-slot="log-list"', () => {
    const { container } = render(<LogList entries={[makeEntry()]} />)
    expect(container.querySelector('[data-slot="log-list"]')).not.toBeNull()
  })
})
