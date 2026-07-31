import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

jest.mock('next/link', () => {
  const MockLink = ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  )
  MockLink.displayName = 'MockLink'
  return MockLink
})

jest.mock('../injection/InjectionSpot', () => ({
  InjectionSpot: () => null,
}))

jest.mock('../injection/useInjectedMenuItems', () => ({
  useInjectedMenuItems: () => ({ items: [], isLoading: false }),
}))

jest.mock('@open-mercato/ui/theme', () => ({
  useTheme: () => ({ theme: 'light', resolvedTheme: 'light', setTheme: jest.fn() }),
}))

import { ProfileDropdown } from '../ProfileDropdown'

describe('ProfileDropdown', () => {
  it('does not render the menu until the trigger is clicked', () => {
    renderWithProviders(<ProfileDropdown email="user@example.com" />)
    expect(screen.queryByTestId('profile-dropdown')).not.toBeInTheDocument()
  })

  it('renders the open menu in a body portal so it escapes the header stacking context', () => {
    renderWithProviders(<ProfileDropdown email="user@example.com" />)

    fireEvent.click(screen.getByTestId('profile-dropdown-trigger'))

    const menu = screen.getByTestId('profile-dropdown')
    expect(menu).toBeInTheDocument()
    // createPortal mounts the menu directly under document.body, outside the
    // sticky header's backdrop-blur stacking context (regression: issue #2941).
    expect(menu.parentElement).toBe(document.body)
    // It must use fixed positioning + the popover layer rather than being
    // absolutely positioned inside the header.
    expect(menu.className).toContain('fixed')
    expect(menu.className).toContain('z-popover')
    expect(menu.className).not.toContain('absolute')
  })

  it('closes the menu (unmounting the portal) on Escape', () => {
    renderWithProviders(<ProfileDropdown email="user@example.com" />)

    fireEvent.click(screen.getByTestId('profile-dropdown-trigger'))
    expect(screen.getByTestId('profile-dropdown')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('profile-dropdown')).not.toBeInTheDocument()
  })
})
