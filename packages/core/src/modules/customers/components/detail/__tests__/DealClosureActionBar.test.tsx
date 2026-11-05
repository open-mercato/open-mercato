/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { DealClosureActionBar } from '../DealClosureActionBar'

describe('DealClosureActionBar', () => {
  it('opens Won and Lost from a single Close deal menu', () => {
    const onWon = jest.fn()
    const onLost = jest.fn()
    renderWithProviders(<DealClosureActionBar closureOutcome={null} onWon={onWon} onLost={onLost} />)

    expect(screen.queryByRole('button', { name: 'Won' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close deal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Won' }))
    expect(onWon).toHaveBeenCalledTimes(1)
    expect(onLost).not.toHaveBeenCalled()
  })

  it('renders nothing once the deal is closed', () => {
    const { container } = renderWithProviders(
      <DealClosureActionBar closureOutcome="won" onWon={jest.fn()} onLost={jest.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
