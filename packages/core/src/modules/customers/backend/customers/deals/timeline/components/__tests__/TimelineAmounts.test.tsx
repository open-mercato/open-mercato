/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { TimelineAmounts, visibleTimelineAmounts } from '../TimelineAmounts'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useLocale: () => 'en',
  useT: () => (key: string, fallbackOrParams?: unknown, maybeParams?: Record<string, unknown>) => {
    const fallback = typeof fallbackOrParams === 'string' ? fallbackOrParams : key
    const params = typeof fallbackOrParams === 'object' && fallbackOrParams ? (fallbackOrParams as Record<string, unknown>) : maybeParams
    return fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? ''))
  },
}))

describe('TimelineAmounts', () => {
  it('drops empty currencies and sorts by open total', () => {
    const entries = visibleTimelineAmounts(
      [
        { currency: 'USD', open: 1000, weighted: 500, won: 0 },
        { currency: 'EUR', open: 9000, weighted: 4000, won: 0 },
        { currency: 'PLN', open: 0, weighted: 0, won: 300 },
      ],
      false,
    )
    expect(entries.map((entry) => entry.currency)).toEqual(['EUR', 'USD'])
    expect(visibleTimelineAmounts(
      [{ currency: 'PLN', open: 0, weighted: 0, won: 300 }],
      true,
    ).map((entry) => entry.currency)).toEqual(['PLN'])
  })

  it('renders nothing for an empty or missing list', () => {
    const { container } = render(<TimelineAmounts amounts={[]} showWon={false} scopeLabel="Week 46" />)
    expect(container.innerHTML).toBe('')
    const missing = render(<TimelineAmounts amounts={undefined} showWon={false} scopeLabel="Week 46" />)
    expect(missing.container.innerHTML).toBe('')
  })

  it('shows open and weighted totals, and won only when closed deals are visible', () => {
    const amounts = [{ currency: 'EUR', open: 120000, weighted: 70000, won: 30000 }]
    const { rerender } = render(<TimelineAmounts amounts={amounts} showWon={false} scopeLabel="Week 46" />)
    expect(screen.getByText('Open')).toBeTruthy()
    expect(screen.getByText('Weighted')).toBeTruthy()
    expect(screen.queryByText('Won')).toBeNull()
    expect(screen.getByTestId('timeline-amounts').textContent).not.toContain('·')
    rerender(<TimelineAmounts amounts={amounts} showWon scopeLabel="Week 46" />)
    expect(screen.getByText('Won')).toBeTruthy()
  })

  it('offers the other currencies through an accessible control', () => {
    render(
      <TimelineAmounts
        amounts={[
          { currency: 'EUR', open: 9000, weighted: 4000, won: 0 },
          { currency: 'USD', open: 1000, weighted: 500, won: 0 },
        ]}
        showWon={false}
        scopeLabel="Week 46"
      />,
    )
    const control = screen.getByRole('button', { name: 'Show totals in all currencies for Week 46' })
    expect(control.textContent).toBe('Other currencies (1)')
  })

  it('marks capped sums as lower bounds and prints plain numbers without a currency', () => {
    render(
      <TimelineAmounts
        amounts={[{ currency: '', open: 1500, weighted: 600, won: 0 }]}
        showWon={false}
        scopeLabel="Week 46"
        capped
      />,
    )
    const text = screen.getByTestId('timeline-amounts').textContent ?? ''
    expect(text).toContain('1.5K+')
    expect(text).toContain('600+')
  })

  it('keeps a seven-digit total inside its column with truncation and the full value available', () => {
    render(
      <TimelineAmounts
        amounts={[{ currency: 'USD', open: 1234567.89, weighted: 802100, won: 0 }]}
        showWon={false}
        scopeLabel="Alex Chen"
      />,
    )
    const root = screen.getByTestId('timeline-amounts')
    expect(root.className).toContain('min-w-0')
    const openLine = root.querySelector('[data-amount-line="open"]') as HTMLElement
    expect(openLine.className).toContain('min-w-0')
    const value = openLine.querySelector('dd') as HTMLElement
    expect(value.className).toContain('truncate')
    expect(value.getAttribute('title')).toBe('$1,234,567.89')
    expect(value.querySelector('.sr-only')?.textContent).toBe('$1,234,567.89')
    expect(value.querySelector('[aria-hidden="true"]')?.textContent).toBe('$1.2M')
  })

  it('stacks label over amount in the narrow layout', () => {
    render(
      <TimelineAmounts
        amounts={[{ currency: 'USD', open: 1234567.89, weighted: 802100, won: 0 }]}
        showWon={false}
        scopeLabel="Alex Chen"
        layout="stacked"
      />,
    )
    const openLine = screen.getByTestId('timeline-amounts').querySelector('[data-amount-line="open"]') as HTMLElement
    expect(openLine.className).toContain('flex-col')
    expect(openLine.querySelector('dt')?.className).toContain('truncate')
  })
})
