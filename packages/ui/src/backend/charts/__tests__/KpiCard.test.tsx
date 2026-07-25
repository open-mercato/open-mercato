/**
 * @jest-environment jsdom
 */
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
})
