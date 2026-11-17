/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { KpiCard } from '../KpiCard'

describe('KpiCard', () => {
  it('keeps the footer when there is no value, because the footer is what explains the dash', () => {
    render(<KpiCard title="Latest NPS" value={null} footer={<span>Never answered a survey</span>} />)
    expect(screen.getByText('--')).toBeTruthy()
    expect(screen.getByText('Never answered a survey')).toBeTruthy()
  })

  it('renders the footer beside a value as before', () => {
    render(<KpiCard title="Orders" value={3} footer={<span>last 30 days</span>} />)
    expect(screen.getByText('last 30 days')).toBeTruthy()
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
