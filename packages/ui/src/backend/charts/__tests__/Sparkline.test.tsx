/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { Sparkline } from '../Sparkline'

describe('Sparkline', () => {
  it('stays a plain image without point labels', () => {
    const { container } = render(<Sparkline values={[1, 2, 3]} ariaLabel="Trend" className="h-10" />)
    expect(screen.getByRole('img', { name: 'Trend' })).toHaveClass('h-10')
    expect(container.querySelector('[data-slot=sparkline-interactive]')).toBeNull()
  })

  it('shows the label and formatted value of the inspected point, moved with the arrow keys', () => {
    render(
      <Sparkline
        values={[10, 25, 40]}
        pointLabels={['Oct 12', 'Oct 13', 'Oct 14']}
        formatValue={(value) => `${value} USD`}
        ariaLabel="Revenue"
      />,
    )
    const chart = screen.getByRole('img', { name: 'Revenue' })
    expect(screen.queryByRole('status')).toBeNull()

    fireEvent.keyDown(chart, { key: 'ArrowRight' })
    expect(screen.getByRole('status')).toHaveTextContent('Oct 1210 USD')
    fireEvent.keyDown(chart, { key: 'ArrowRight' })
    expect(screen.getByRole('status')).toHaveTextContent('Oct 1325 USD')
    fireEvent.keyDown(chart, { key: 'ArrowLeft' })
    expect(screen.getByRole('status')).toHaveTextContent('Oct 1210 USD')

    fireEvent.blur(chart)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('ignores point labels that do not match the series', () => {
    const { container } = render(<Sparkline values={[1, 2, 3]} pointLabels={['only one']} ariaLabel="Trend" />)
    expect(container.querySelector('[data-slot=sparkline-interactive]')).toBeNull()
  })
})
