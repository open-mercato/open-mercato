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

jest.mock('../injection/useInjectedMenuItems', () => ({
  useInjectedMenuItems: () => ({
    items: [],
    isLoading: false,
  }),
}))

jest.mock('../injection/eventBridge', () => ({
  useEventBridge: jest.fn(),
}))

jest.mock('../injection/StatusBadgeInjectionSpot', () => ({
  StatusBadgeInjectionSpot: () => <div data-testid="status-badge-injection-spot" />,
}))

jest.mock('../operations/LastOperationBanner', () => ({
  LastOperationBanner: () => <div data-testid="last-operation-banner" />,
}))

jest.mock('../progress/ProgressTopBar', () => ({
  ProgressTopBar: () => <div data-testid="progress-top-bar" />,
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

jest.mock('../devtools', () => ({
  UmesDevToolsPanel: () => null,
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
    if (typeof globalThis.Response === 'undefined') {
      globalThis.Response = class MockResponse {
        _body: string; status: number; headers: Headers
        constructor(body?: string | null, init?: ResponseInit) {
          this._body = body ?? ''; this.status = init?.status ?? 200
          this.headers = new Headers(init?.headers)
        }
        get ok() { return this.status >= 200 && this.status < 300 }
        async json() { return JSON.parse(this._body) }
        async text() { return this._body }
      } as unknown as typeof Response
    }
    if (!globalThis.fetch) {
      globalThis.fetch = jest.fn().mockResolvedValue(
        new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } }),
      ) as typeof fetch
    }
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

  it('resets breadcrumb to server-provided values when pathname changes', async () => {
    mockPathname = '/backend/users'

    const { rerender } = renderWithProviders(
      <AppShell
        email="demo@example.com"
        groups={groups}
        currentTitle="Users List"
        breadcrumb={[{ label: 'Users List' }]}
      >
        <div>Page content</div>
      </AppShell>,
      { dict },
    )

    const getBreadcrumbText = () => {
      const allNavs = screen.getAllByRole('navigation')
      const breadcrumbNav = allNavs.find((nav) => nav.classList.contains('text-sm'))
      return breadcrumbNav?.textContent ?? ''
    }

    await waitFor(() => {
      expect(getBreadcrumbText()).toContain('Users List')
    })

    mockPathname = '/backend'

    rerender(
      <AppShell
        email="demo@example.com"
        groups={groups}
        currentTitle=""
      >
        <div>Dashboard content</div>
      </AppShell>,
    )

    await waitFor(() => {
      expect(screen.getByText('Dashboard content')).toBeInTheDocument()
      expect(getBreadcrumbText()).not.toContain('Users List')
    })
  })

  it('keeps settings parent item active on descendant routes outside explicit child list', async () => {
    mockPathname = '/backend/entities/user/example%3Acalendar_entity'

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
      expect(screen.getByRole('link', { name: 'User Entities' })).toHaveClass('bg-background')
      expect(screen.getByRole('link', { name: 'Calendar Entity' })).toBeInTheDocument()
    })
  })

  it('hydrates backend chrome from the shared bootstrap payload and flips the ready marker', async () => {
    const previousFetch = global.fetch
    const previousWindowFetch = window.fetch
    const previousOriginalFetch = (window as Window & { __omOriginalFetch?: typeof fetch }).__omOriginalFetch
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.toString()
      if (url.includes('/api/auth/admin/nav')) {
        return new Response(JSON.stringify({
          groups: [
            {
              id: 'core',
              name: 'Core',
              defaultName: 'Core',
              items: [
                {
                  href: '/backend/users',
                  title: 'Users List',
                  defaultTitle: 'Users List',
                  enabled: true,
                },
              ],
            },
          ],
          settingsSections: [],
          settingsPathPrefixes: [],
          profileSections: [],
          profilePathPrefixes: ['/backend/profile/'],
          grantedFeatures: ['auth.*'],
          roles: ['admin'],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch
    global.fetch = fetchMock
    window.fetch = fetchMock
    ;(window as Window & { __omOriginalFetch?: typeof fetch }).__omOriginalFetch = fetchMock

    try {
      renderWithProviders(
        <AppShell
          email="demo@example.com"
          groups={[]}
          adminNavApi="/api/auth/admin/nav"
        >
          <div>Hydrated content</div>
        </AppShell>,
        { dict },
      )

      expect(screen.getByTestId('backend-chrome-ready')).toHaveAttribute('data-ready', 'false')

      await waitFor(() => {
        expect(screen.getByTestId('backend-chrome-ready')).toHaveAttribute('data-ready', 'true')
        expect(screen.getByText('Users List')).toBeInTheDocument()
      })
    } finally {
      global.fetch = previousFetch
      window.fetch = previousWindowFetch
      ;(window as Window & { __omOriginalFetch?: typeof fetch }).__omOriginalFetch = previousOriginalFetch
    }
  })

  it('renders nav icons from iconName when iconMarkup is missing', async () => {
    const previousFetch = global.fetch
    const previousWindowFetch = window.fetch
    const previousOriginalFetch = (window as Window & { __omOriginalFetch?: typeof fetch }).__omOriginalFetch
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.toString()
      if (url.includes('/api/auth/admin/nav-icon-fallback')) {
        return new Response(JSON.stringify({
          groups: [
            {
              id: 'checkout',
              name: 'Checkout',
              defaultName: 'Checkout',
              items: [
                {
                  href: '/backend/checkout/pay-links',
                  title: 'Pay Links',
                  defaultTitle: 'Pay Links',
                  enabled: true,
                  iconName: 'ticket',
                },
              ],
            },
          ],
          settingsSections: [],
          settingsPathPrefixes: [],
          profileSections: [],
          profilePathPrefixes: ['/backend/profile/'],
          grantedFeatures: ['checkout.view'],
          roles: ['admin'],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch
    global.fetch = fetchMock
    window.fetch = fetchMock
    ;(window as Window & { __omOriginalFetch?: typeof fetch }).__omOriginalFetch = fetchMock

    try {
      renderWithProviders(
        <AppShell
          email="demo@example.com"
          groups={[]}
          adminNavApi="/api/auth/admin/nav-icon-fallback"
        >
          <div>Hydrated content</div>
        </AppShell>,
        { dict },
      )

      await waitFor(() => {
        expect(screen.getByText('Pay Links')).toBeInTheDocument()
      })

      const link = screen.getByRole('link', { name: 'Pay Links' })
      expect(link.querySelector('svg.lucide-ticket')).toBeTruthy()
    } finally {
      global.fetch = previousFetch
      window.fetch = previousWindowFetch
      ;(window as Window & { __omOriginalFetch?: typeof fetch }).__omOriginalFetch = previousOriginalFetch
    }
  })
})
