/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { KpiCard } from '../KpiCard'

describe('KpiCard', () => {
  it.each([
    'target 8:00 — 6:00 to go',
    'of 40:00',
    '21 working days',
    '16.7% of the month',
  ])('shows the comparison caption without a trend: %s', (comparisonLabel) => {
    render(<KpiCard title="Today" value={120} comparisonLabel={comparisonLabel} />)

    expect(screen.getByText(comparisonLabel)).toBeVisible()
    expect(screen.queryByTitle('Compared to previous period')).toBeNull()
  })

  it('shows the comparison caption alongside a supplied trend', () => {
    render(<KpiCard title="Orders" value={3} comparisonLabel="last month" trend={{ value: 10, direction: 'up' }} />)

    expect(screen.getByText('last month')).toBeVisible()
    expect(screen.getByText('10%')).toBeVisible()
  })

  it('keeps the footer when there is no value, because the footer is what explains the dash', () => {
    render(<KpiCard title="Latest NPS" value={null} footer={<span>Never answered a survey</span>} />)
    expect(screen.getByText('--')).toBeTruthy()
    expect(screen.getByText('Never answered a survey')).toBeTruthy()
  })

  it('renders the footer beside a value as before', () => {
    render(<KpiCard title="Orders" value={3} footer={<span>last 30 days</span>} />)
    expect(screen.getByText('last 30 days')).toBeTruthy()
  })

  test('does not render a sparkline without trend values', () => {
    render(<KpiCard title="Revenue" value={123} formatValue={(value) => String(value)} />)

    expect(screen.getByText('Revenue')).toBeInTheDocument()
    expect(screen.getByText('123')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  test('renders a sparkline when trend values are provided', () => {
    render(<KpiCard title="Revenue" value={123} trend={[1, 3, 2, 5]} formatValue={(value) => String(value)} />)

    expect(screen.getByRole('img', { name: 'Revenue' })).toBeInTheDocument()
  })

  test('renders a signal badge instead of the delta badge and keeps the delta as text', () => {
    render(
      <KpiCard
        title="Orders"
        value={42}
        trend={[1, 2, 3, 4, 5, 6, 7, 8]}
        delta={{ value: 12, direction: 'up' }}
        comparisonLabel="vs previous period"
        signal={{ variant: 'neutral', label: 'Within normal range', band: { lower: 0, upper: 10, centre: 5 }, completeCount: 7, highlightIndexes: [3] }}
      />,
    )

    expect(screen.getByText('Within normal range')).toBeInTheDocument()
    expect(screen.getByText(/\+12% vs previous period/)).toBeInTheDocument()
    const chart = screen.getByRole('img', { name: 'Orders' })
    expect(chart.querySelector('[data-slot="sparkline-band"]')).not.toBeNull()
    expect(chart.querySelector('[data-slot="sparkline-incomplete"]')).not.toBeNull()
    expect(chart.querySelectorAll('[data-slot="sparkline-highlight"]')).toHaveLength(1)
  })
})

describe('resolveChartColor', () => {
  it('maps named colours, passes raw CSS colours through and falls back to the palette', async () => {
    const { resolveChartColor, CHART_COLORS } = await import('../ChartUtils')
    expect(resolveChartColor('blue', 0)).toBe('var(--chart-blue)')
    expect(resolveChartColor('var(--foreground)', 0)).toBe('var(--foreground)')
    expect(resolveChartColor('#123456', 0)).toBe('#123456')
    expect(resolveChartColor('oklch(0.5 0.1 200)', 0)).toBe('oklch(0.5 0.1 200)')
    expect(resolveChartColor('nope', 1)).toBe(CHART_COLORS[1])
    expect(resolveChartColor(undefined, 7)).toBe(CHART_COLORS[7 % CHART_COLORS.length])
  })
})
