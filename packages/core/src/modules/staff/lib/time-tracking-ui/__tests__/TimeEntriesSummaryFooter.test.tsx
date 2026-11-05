/**
 * @jest-environment jsdom
 */
// #6990: the footer used to sum only the rows of the current page while reading
// like the total for the whole period. With the list API's whole-set `totals` it
// must show those instead, and still fall back to the page sums without them.
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { TimeEntriesSummaryFooter } from '../TimeEntriesSummaryFooter'
import widget from '../../../widgets/injection/time-entries-summary-footer/widget'

const mockTranslate = (_key: string, fallback?: string, params?: Record<string, unknown>) =>
  (fallback ?? '').replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? ''))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('@open-mercato/ui/backend/injection/useRegisteredComponent', () => ({
  useRegisteredComponent: (_id: string, fallback: unknown) => fallback,
}))

const pageSummary = {
  visibleCount: 2,
  totalMinutes: 90,
  money: [{ currencyCode: 'PLN', amount: 150 }],
}

describe('TimeEntriesSummaryFooter', () => {
  it('keeps the page-only sums when no whole-set totals are given', () => {
    render(<TimeEntriesSummaryFooter summary={pageSummary} totalCount={300} canSeeMoney={false} />)
    const footer = screen.getByTestId('entries-summary-footer')
    expect(footer.getAttribute('data-summary-scope')).toBe('page')
    expect(footer.textContent).toContain('Total (2 of 300 entries)')
    expect(screen.getByTestId('entries-summary-duration').textContent).toContain('1:30')
  })

  it('shows the whole filtered set when totals are present', () => {
    render(
      <TimeEntriesSummaryFooter
        summary={pageSummary}
        totalCount={300}
        canSeeMoney
        totals={{
          entryCount: 300,
          durationMinutes: 18000,
          roundedMinutes: 18015,
          money: [
            { currencyCode: 'EUR', amount: 200 },
            { currencyCode: 'PLN', amount: 4315.5 },
          ],
        }}
      />,
    )
    const footer = screen.getByTestId('entries-summary-footer')
    expect(footer.getAttribute('data-summary-scope')).toBe('filtered')
    expect(footer.hasAttribute('data-staff-entries-summary-footer')).toBe(true)
    expect(footer.textContent).toContain('Total of all 300 matching entries')
    expect(screen.getByTestId('entries-summary-duration').textContent).toContain('300:00')
    expect(screen.getAllByTestId('entries-summary-money')).toHaveLength(2)
  })

  it('hides money from a caller who may not see rates even when totals carry it', () => {
    render(
      <TimeEntriesSummaryFooter
        summary={pageSummary}
        totalCount={1}
        canSeeMoney={false}
        totals={{ entryCount: 1, durationMinutes: 60, roundedMinutes: 60, money: [{ currencyCode: 'PLN', amount: 100 }] }}
      />,
    )
    expect(screen.queryByTestId('entries-summary-money')).toBeNull()
  })
})

describe('time-entries summary footer widget', () => {
  it('renders the footer from the table injection context', () => {
    const { Widget } = widget
    render(
      <Widget
        context={{
          tableId: 'staff.time_entries.list',
          entriesSummary: {
            summary: pageSummary,
            totalCount: 5,
            canSeeMoney: false,
            totals: { entryCount: 5, durationMinutes: 300, roundedMinutes: 300 },
          },
        }}
      />,
    )
    expect(screen.getByTestId('entries-summary-footer').textContent).toContain('Total of all 5 matching entries')
  })

  it('renders nothing when the host passes no summary', () => {
    const { Widget } = widget
    const { container } = render(<Widget context={{ tableId: 'staff.time_entries.list' }} />)
    expect(container.innerHTML).toBe('')
  })
})
