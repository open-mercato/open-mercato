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

const mockSetTheme = jest.fn()

jest.mock('@open-mercato/ui/theme', () => ({
  useTheme: () => ({ theme: 'light', resolvedTheme: 'light', setTheme: mockSetTheme }),
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

  describe('keyboard', () => {
    function openMenu() {
      renderWithProviders(
        <ProfileDropdown email="user@example.com" notificationsHref="/backend/notifications" />,
        { supportedLocales: ['en', 'pl'] },
      )
      const trigger = screen.getByTestId('profile-dropdown-trigger')
      trigger.focus()
      fireEvent.click(trigger)
      const menu = screen.getByTestId('profile-dropdown')
      const items = () => Array.from(menu.querySelectorAll<HTMLElement>('[role^="menuitem"]'))
      const press = (key: string, init: { shiftKey?: boolean } = {}) =>
        fireEvent.keyDown(document.activeElement as Element, { key, ...init })
      return { trigger, menu, items, press }
    }

    it('moves focus to the first menu item when the menu opens', () => {
      const { items } = openMenu()

      expect(document.activeElement).toBe(items()[0])
    })

    it('moves between items with the arrow keys, Home and End', () => {
      const { items, press } = openMenu()
      const last = items().length - 1

      press('ArrowDown')
      expect(document.activeElement).toBe(items()[1])
      press('ArrowUp')
      expect(document.activeElement).toBe(items()[0])
      press('ArrowUp')
      expect(document.activeElement).toBe(items()[last])
      press('ArrowDown')
      expect(document.activeElement).toBe(items()[0])
      press('End')
      expect(document.activeElement).toBe(items()[last])
      press('Home')
      expect(document.activeElement).toBe(items()[0])
    })

    it('keeps Tab inside the menu instead of leaving it for the page', () => {
      const { items, press } = openMenu()
      const last = items().length - 1

      press('End')
      expect(press('Tab')).toBe(false)
      expect(document.activeElement).toBe(items()[0])
      expect(press('Tab', { shiftKey: true })).toBe(false)
      expect(document.activeElement).toBe(items()[last])
    })

    it('walks into the menu with ArrowDown when focus is back on the trigger', () => {
      const { trigger, items, press } = openMenu()

      trigger.focus()
      press('ArrowDown')

      expect(document.activeElement).toBe(items()[0])
    })

    it('reaches the language options once the list is expanded', () => {
      const { menu, press } = openMenu()
      const languageTrigger = within(menu).getByText('Language').closest('button') as HTMLElement

      fireEvent.click(languageTrigger)
      languageTrigger.focus()
      press('ArrowDown')
      expect(document.activeElement?.textContent?.trim()).toBe('English')
      press('ArrowDown')
      expect(document.activeElement?.textContent?.trim()).toBe('Polski')
    })

    it('returns focus to the language row when Escape collapses its options', () => {
      const { menu, press } = openMenu()
      const languageTrigger = within(menu).getByText('Language').closest('button') as HTMLElement

      fireEvent.click(languageTrigger)
      languageTrigger.focus()
      press('ArrowDown')
      press('Escape')

      expect(screen.getByTestId('profile-dropdown')).toBeInTheDocument()
      expect(languageTrigger).toHaveAttribute('aria-expanded', 'false')
      expect(document.activeElement).toBe(languageTrigger)
    })

    it('does not stop on the switch drawn in the theme row', () => {
      const { menu, items, press } = openMenu()
      const themeSwitch = menu.querySelector('[role="switch"]')
      const visited: Array<Element | null> = []

      for (let index = 0; index < items().length; index += 1) {
        visited.push(document.activeElement)
        press('ArrowDown')
      }

      expect(themeSwitch).not.toBeNull()
      expect(visited).toEqual(items())
      expect(visited).not.toContain(themeSwitch)
    })

    it('keeps focus where it is when the open menu repositions', () => {
      const { items, press } = openMenu()

      press('ArrowDown')
      fireEvent(window, new Event('resize'))

      expect(document.activeElement).toBe(items()[1])
    })

    it('returns focus to the trigger when Escape closes the menu', () => {
      const { trigger, press } = openMenu()

      press('Escape')

      expect(screen.queryByTestId('profile-dropdown')).not.toBeInTheDocument()
      expect(document.activeElement).toBe(trigger)
    })

    it('ignores arrow keys while focus is elsewhere on the page', () => {
      const { items } = openMenu()
      const outside = document.createElement('input')
      document.body.appendChild(outside)
      outside.focus()

      expect(fireEvent.keyDown(outside, { key: 'ArrowDown' })).toBe(true)
      expect(document.activeElement).toBe(outside)
      expect(items().length).toBeGreaterThan(0)
      outside.remove()
    })
  })

  // The theme row used to be a menu item with a focusable switch inside it: two
  // overlapping targets for one action, the inner one 32x20 px.
  describe('theme row', () => {
    function openMenu() {
      mockSetTheme.mockClear()
      renderWithProviders(<ProfileDropdown email="user@example.com" />)
      fireEvent.click(screen.getByTestId('profile-dropdown-trigger'))
      const menu = screen.getByTestId('profile-dropdown')
      return { menu, row: within(menu).getByRole('menuitemcheckbox', { name: 'Theme' }) }
    }

    it('is one checkbox menu item that reports the current theme', () => {
      const { menu, row } = openMenu()

      expect(row).toHaveAttribute('aria-checked', 'false')
      expect(within(menu).queryByRole('switch')).toBeNull()
      expect(row.querySelectorAll('button:not([tabindex="-1"]), a[href], [tabindex="0"]')).toHaveLength(0)
    })

    // A negative tabindex still leaves the switch focusable by script or
    // pointer, which is why axe reports the row as nested-interactive.
    it('keeps the drawn switch inert so the row has no focusable descendant', () => {
      const { menu, row } = openMenu()
      const drawnSwitch = menu.querySelector('[role="switch"]') as HTMLElement

      expect(drawnSwitch.closest('[inert]')).not.toBeNull()
      expect(row.contains(drawnSwitch.closest('[inert]'))).toBe(true)
      expect(row).not.toHaveAttribute('inert')
    })

    it('toggles the theme with a click, Enter and Space', () => {
      const { row } = openMenu()

      fireEvent.click(row)
      fireEvent.keyDown(row, { key: 'Enter' })
      fireEvent.keyDown(row, { key: ' ' })

      expect(mockSetTheme).toHaveBeenCalledTimes(3)
      expect(mockSetTheme).toHaveBeenCalledWith('dark')
    })

    it('toggles once when the drawn switch itself is clicked', () => {
      const { menu } = openMenu()

      fireEvent.click(menu.querySelector('[role="switch"]') as HTMLElement)

      expect(mockSetTheme).toHaveBeenCalledTimes(1)
    })
  })
})
