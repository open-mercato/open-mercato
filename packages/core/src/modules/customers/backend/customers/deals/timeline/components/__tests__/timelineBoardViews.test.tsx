/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { NoResultsActions, shouldShowWonAmounts } from '../DealsTimelineBoard'

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}))

describe('shouldShowWonAmounts', () => {
  it('shows won totals only when closed deals are on the board', () => {
    expect(shouldShowWonAmounts({ excludeClosed: true, status: [] })).toBe(false)
    expect(shouldShowWonAmounts({ excludeClosed: false, status: [] })).toBe(true)
    expect(shouldShowWonAmounts({ excludeClosed: true, status: ['open'] })).toBe(false)
    expect(shouldShowWonAmounts({ excludeClosed: false, status: ['Win'] })).toBe(true)
    expect(shouldShowWonAmounts({ excludeClosed: true, status: ['won'] })).toBe(true)
  })
})

describe('NoResultsActions', () => {
  it('renders nothing without actions', () => {
    const { container } = render(<NoResultsActions actions={[]} />)
    expect(container.innerHTML).toBe('')
  })

  it('promotes only the first action and demotes the rest', () => {
    const clear = jest.fn()
    const showClosed = jest.fn()
    const next = jest.fn()
    render(
      <NoResultsActions
        actions={[
          { id: 'clear-filters', label: 'Clear filters', onClick: clear },
          { id: 'show-closed', label: 'Show closed deals', onClick: showClosed },
          { id: 'jump-next', label: 'Jump to next deal', onClick: next },
        ]}
      />,
    )
    const primary = screen.getByRole('button', { name: 'Clear filters' })
    const secondary = screen.getByRole('button', { name: 'Show closed deals' })
    expect(primary.getAttribute('data-action-id')).toBe('clear-filters')
    expect(primary.className).not.toBe(secondary.className)
    expect(secondary.className).toBe(screen.getByRole('button', { name: 'Jump to next deal' }).className)
    fireEvent.click(secondary)
    expect(showClosed).toHaveBeenCalledTimes(1)
    fireEvent.click(primary)
    expect(clear).toHaveBeenCalledTimes(1)
  })
})
