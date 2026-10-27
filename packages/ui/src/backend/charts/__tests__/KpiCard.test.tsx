/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { KpiCard } from '../KpiCard'

describe('KpiCard', () => {
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
