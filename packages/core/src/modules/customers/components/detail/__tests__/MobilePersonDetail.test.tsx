/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { MobilePersonDetail } from '../MobilePersonDetail'

const routerReplaceMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: (...args: unknown[]) => routerReplaceMock(...args) }),
  useSearchParams: () => new URLSearchParams(),
}))

describe('MobilePersonDetail', () => {
  beforeEach(() => {
    routerReplaceMock.mockReset()
  })

  it('renders Details by default and swaps to Activity on tab click', () => {
    renderWithProviders(
      <MobilePersonDetail
        zone1={<div>Details zone content</div>}
        zone2={<div>Activity zone content</div>}
      />,
    )

    expect(screen.getByText('Details zone content')).toBeInTheDocument()
    expect(screen.queryByText('Activity zone content')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }))

    expect(screen.getByText('Activity zone content')).toBeInTheDocument()
    expect(screen.queryByText('Details zone content')).not.toBeInTheDocument()
  })

  it('updates the URL ?zone param when switching zones', () => {
    renderWithProviders(
      <MobilePersonDetail
        zone1={<div>Details</div>}
        zone2={<div>Activity</div>}
      />,
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }))

    expect(routerReplaceMock).toHaveBeenCalledWith('?zone=activity', { scroll: false })
  })

  it('swaps zones via ArrowLeft/ArrowRight on the tablist', () => {
    renderWithProviders(
      <MobilePersonDetail
        zone1={<div>Details zone content</div>}
        zone2={<div>Activity zone content</div>}
      />,
    )

    const tablist = screen.getByRole('tablist', { name: 'Zone selector' })
    act(() => {
      fireEvent.keyDown(tablist, { key: 'ArrowRight' })
    })
    expect(screen.getByText('Activity zone content')).toBeInTheDocument()

    act(() => {
      fireEvent.keyDown(tablist, { key: 'ArrowLeft' })
    })
    expect(screen.getByText('Details zone content')).toBeInTheDocument()
  })

  it('marks the active tab with aria-selected=true and the inactive tab with false', () => {
    renderWithProviders(
      <MobilePersonDetail
        zone1={<div>Details zone content</div>}
        zone2={<div>Activity zone content</div>}
      />,
    )

    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'false')

    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }))

    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'true')
  })
})
