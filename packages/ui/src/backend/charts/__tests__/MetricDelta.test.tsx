/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { MetricDelta, relativeChange } from '../MetricDelta'
import { SignalBadge } from '../SignalBadge'

describe('MetricDelta', () => {
  it('shows a signed percent in the error colour for a drop, followed by the comparison label', () => {
    render(<MetricDelta deltaPct={-0.179} label="vs previous period" locale="en" />)
    const percent = screen.getByText('-17.9%')
    expect(percent).toHaveClass('text-status-error-text')
    expect(screen.getByText('vs previous period')).toBeInTheDocument()
  })

  it('uses the success colour for a rise and keeps only the label when there is nothing to compare', () => {
    const { rerender, container } = render(<MetricDelta deltaPct={0.158} locale="en" />)
    expect(screen.getByText('+15.8%')).toHaveClass('text-status-success-text')
    rerender(<MetricDelta deltaPct={null} label="No comparison" locale="en" />)
    expect(container.textContent).toBe('No comparison')
    rerender(<MetricDelta deltaPct={null} locale="en" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('computes the relative change only when the previous value can anchor a percent', () => {
    expect(relativeChange(50, 100)).toBe(-0.5)
    expect(relativeChange(50, 0)).toBeNull()
    expect(relativeChange(50, null)).toBeNull()
  })
})

describe('SignalBadge', () => {
  it('renders the label with an icon for the kind of change', () => {
    const { container } = render(<SignalBadge variant="warning" label="Sustained drop" kind="shift-down" />)
    expect(screen.getByText('Sustained drop')).toBeInTheDocument()
    expect(container.querySelector('svg')).not.toBeNull()
  })
})
