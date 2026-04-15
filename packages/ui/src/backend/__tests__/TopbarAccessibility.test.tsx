import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { SettingsButton } from '../SettingsButton'
import { UserMenu } from '../UserMenu'
import { ProfileDropdown } from '../ProfileDropdown'

jest.mock('next/link', () => {
  const React = require('react')
  return React.forwardRef(({ children, href, ...rest }: any, ref: React.ForwardedRef<HTMLAnchorElement>) => (
    <a href={typeof href === 'string' ? href : href?.toString?.()} ref={ref} {...rest}>
      {children}
    </a>
  ))
})

jest.mock('../injection/useInjectedMenuItems', () => ({
  useInjectedMenuItems: () => ({ items: [] }),
}))

jest.mock('../injection/InjectionSpot', () => ({
  InjectionSpot: () => null,
}))

jest.mock('@open-mercato/ui/theme', () => ({
  useTheme: () => ({
    resolvedTheme: 'light',
    setTheme: jest.fn(),
  }),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/i18n/context'),
  useLocale: () => 'en',
}))

describe('backend topbar accessibility labels', () => {
  it('adds aria labels to icon-only controls', () => {
    renderWithProviders(
      <div>
        <SettingsButton />
        <UserMenu email="user@example.com" />
        <ProfileDropdown email="user@example.com" />
      </div>,
      {
        dict: {
          'backend.nav.settings': 'Settings',
          'ui.userMenu.userFallback': 'User',
        },
      },
    )

    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'user@example.com' })).toHaveLength(2)
  })
})
