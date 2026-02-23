/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { AppShell, ApplyBreadcrumb } from '../AppShell'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const mockInjectionSpot = jest.fn()
let mockPathname = '/backend/users'

jest.mock('next/link', () => {
  const React = require('react')
  return React.forwardRef(({ children, href, ...rest }: any, ref: React.ForwardedRef<HTMLAnchorElement>) => (
    <a href={typeof href === 'string' ? href : href?.toString?.()} ref={ref} {...rest}>
      {children}
    </a>
  ))
})

jest.mock('next/image', () => (props: any) => <img alt={props.alt} {...props} />)

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams('tab=profile'),
  useRouter: () => ({
    refresh: jest.fn(),
    push: jest.fn(),
  }),
}))

jest.mock('../injection/InjectionSpot', () => ({
  InjectionSpot: (props: { spotId: string; context?: Record<string, unknown> }) => {
    mockInjectionSpot(props)
    return <div data-testid={`injection-spot:${props.spotId}`} />
  },
}))

jest.mock('../operations/LastOperationBanner', () => ({
  LastOperationBanner: () => <div data-testid="last-operation-banner" />,
}))

jest.mock('../indexes/PartialIndexBanner', () => ({
  PartialIndexBanner: () => <div data-testid="partial-index-banner" />,
}))

jest.mock('../FlashMessages', () => ({
  FlashMessages: () => <div data-testid="flash-messages" />,
}))

jest.mock('../../frontend/LanguageSwitcher', () => ({
  LanguageSwitcher: () => <div data-testid="language-switcher" />,
}))

jest.mock('../upgrades/UpgradeActionBanner', () => ({
  UpgradeActionBanner: () => <div data-testid="upgrade-action-banner" />,
}))

const dict = {
  'appShell.productName': 'Mercato',
  'appShell.menu': 'Menu',
  'appShell.toggleSidebar': 'Toggle sidebar',
  'appShell.collapseSidebar': 'Collapse',
  'appShell.expandSidebar': 'Expand',
  'appShell.userFallback': 'User',
  'appShell.goToDashboard': 'Go to dashboard',
  'appShell.closeMenu': 'Close',
  'common.terms': 'Terms',
  'common.privacy': 'Privacy',
  'dashboard.title': 'Dashboard',
  'custom.page.title': 'Custom Page',
  'custom.page.breadcrumb': 'Custom Trail',
}

const groups = [
  {
    id: 'core',
    name: 'Core',
    items: [
      { href: '/backend/users', title: 'Users List' },
      { href: '/backend/roles', title: 'Roles' },
    ],
  },
]

describe('AppShell', () => {
  beforeEach(() => {
    mockInjectionSpot.mockClear()
    mockPathname = '/backend/users'
  })

  beforeAll(() => {
    const storage: Record<string, string> = {}
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: (key: string) => storage[key] ?? null,
        setItem: (key: string, value: string) => {
          storage[key] = value
        },
        removeItem: (key: string) => {
          delete storage[key]
        },
      },
      configurable: true,
    })
  })

  it('renders navigation and breadcrumbs with translations applied via ApplyBreadcrumb', async () => {
    renderWithProviders(
      <AppShell
        email="demo@example.com"
        groups={groups}
        breadcrumb={[{ label: 'Initial' }]}
        currentTitle="Initial"
      >
        <ApplyBreadcrumb
          titleKey="custom.page.title"
          breadcrumb={[{ label: 'Custom Trail', labelKey: 'custom.page.breadcrumb', href: '/custom' }]}
        />
        <div>Child content</div>
      </AppShell>,
      { dict },
    )

    expect(screen.getByText('Users List')).toBeInTheDocument()
    expect(screen.getAllByText('Terms')[0]).toBeInTheDocument()
    expect(screen.getByTestId('flash-messages')).toBeInTheDocument()
    expect(screen.getByTestId('injection-spot:backend:layout:top')).toBeInTheDocument()
    expect(screen.getByTestId('injection-spot:backend:record:current')).toBeInTheDocument()
    expect(screen.getByTestId('injection-spot:backend:layout:footer')).toBeInTheDocument()
    expect(screen.getByTestId('injection-spot:backend:sidebar:top')).toBeInTheDocument()
    expect(screen.getByTestId('injection-spot:backend:sidebar:footer')).toBeInTheDocument()
    expect(screen.getByTestId('injection-spot:backend-mutation:global')).toBeInTheDocument()
    expect(screen.getByText('Child content')).toBeInTheDocument()
    expect(mockInjectionSpot).toHaveBeenCalledWith(
      expect.objectContaining({
        spotId: 'backend-mutation:global',
        context: {
          path: '/backend/users',
          query: 'tab=profile',
        },
      }),
    )
    expect(mockInjectionSpot).toHaveBeenCalledWith(
      expect.objectContaining({
        spotId: 'backend:record:current',
        context: {
          path: '/backend/users',
          query: 'tab=profile',
        },
      }),
    )
  })

  it('renders nested settings links when settings parent route is active', async () => {
    mockPathname = '/backend/entities/user'

    renderWithProviders(
      <AppShell
        email="demo@example.com"
        groups={groups}
        settingsPathPrefixes={['/backend/entities/user']}
        settingsSections={[
          {
            id: 'data-designer',
            label: 'Data Designer',
            items: [
              {
                id: 'user-entities',
                label: 'User Entities',
                href: '/backend/entities/user',
                children: [
                  {
                    id: 'calendar-entity',
                    label: 'Calendar Entity',
                    href: '/backend/entities/user/example%3Acalendar_entity/records',
                  },
                ],
              },
            ],
          },
        ]}
      >
        <div>Settings content</div>
      </AppShell>,
      { dict },
    )

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Calendar Entity' })).toHaveAttribute(
        'href',
        '/backend/entities/user/example%3Acalendar_entity/records',
      )
    })
  })
})
