import * as React from 'react'
import { fireEvent, screen, within } from '@testing-library/react'
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

  it('offers exactly the served locale set, not every locale the platform ships', () => {
    // The tenant's Settings → Translations selection is resolved on the server and
    // handed down through the provider. Rendering the process-wide set here is what
    // made the operations-level control look like it did nothing (UX finding 1).
    renderWithProviders(<ProfileDropdown email="user@example.com" />, {
      supportedLocales: ['en', 'pl', 'de'],
    })

    fireEvent.click(screen.getByTestId('profile-dropdown-trigger'))
    const languageTrigger = screen.getByText('Language').closest('button') as HTMLElement
    fireEvent.click(languageTrigger)

    const options = languageTrigger.nextElementSibling as HTMLElement
    const rendered = within(options).getAllByRole('button').map((button) => button.textContent?.trim())

    expect(rendered).toEqual(['English', 'Polski', 'Deutsch'])
  })
})
