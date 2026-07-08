import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

jest.mock('@/.mercato/generated/frontend-routes.generated', () => ({
  frontendRoutes: [],
}), { virtual: true })

jest.mock('@/.mercato/generated/frontend-middleware.generated', () => ({
  frontendMiddlewareEntries: [],
}), { virtual: true })

jest.mock('@/bootstrap', () => ({
  bootstrap: jest.fn(),
  isBootstrapped: jest.fn(() => true),
}))

const routeLoad = jest.fn(async () => (props: any) => (
  <div data-testid="portal-page">{props.params.orgSlug}</div>
))

jest.mock('@open-mercato/shared/modules/registry', () => ({
  findRouteManifestMatch: jest.fn(() => ({
    route: {
      requireCustomerAuth: true,
      requireCustomerFeatures: ['portal.dashboard.view'],
      title: 'Dashboard',
      load: routeLoad,
    },
    params: { orgSlug: 'org-b' },
  })),
  getFrontendRouteManifests: jest.fn(() => []),
  registerFrontendRouteManifests: jest.fn(),
}))

const headerStore = { get: jest.fn() }
jest.mock('next/headers', () => ({
  headers: jest.fn(() => headerStore),
  cookies: jest.fn(),
}))

const mockGetCustomerAuthFromCookies = jest.fn()
jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerAuthServer', () => ({
  getCustomerAuthFromCookies: (...args: unknown[]) => mockGetCustomerAuthFromCookies(...args),
}))

jest.mock('@open-mercato/core/modules/directory/data/entities', () => ({
  Organization: class Organization {},
}))

jest.mock('@open-mercato/core/modules/customer_accounts/data/entities', () => ({
  CustomerUser: class CustomerUser {},
}))

const portalShellMock = jest.fn(({ children }: { children: React.ReactNode }) => (
  <div data-testid="portal-shell">{children}</div>
))
jest.mock('@open-mercato/ui/portal/PortalLayoutShell', () => ({
  PortalLayoutShell: (props: any) => portalShellMock(props),
}))

const redirect = jest.fn((href?: string) => {
  throw new Error('REDIRECT ' + href)
})
const notFound = jest.fn(() => {
  throw new Error('NOT_FOUND')
})
jest.mock('next/navigation', () => ({
  redirect: (href?: string) => redirect(href),
  notFound: () => notFound(),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromCookies: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    t: (_key: string, fallback: string) => fallback,
    translate: (_key: string, fallback: string) => fallback,
  }),
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  AccessDeniedMessage: (props: any) => (
    <div data-testid="access-denied">
      {props.label}
      {props.action}
    </div>
  ),
}))

jest.mock('next/link', () => (props: any) => <a href={props.href}>{props.children}</a>)

const orgs = new Map<string, { id: string; name: string; slug: string; tenant: { id: string } }>([
  ['org-a', { id: 'org-a-id', name: 'Org A', slug: 'org-a', tenant: { id: 'tenant-1' } }],
  ['org-b', { id: 'org-b-id', name: 'Org B', slug: 'org-b', tenant: { id: 'tenant-1' } }],
])

const mockEm = {
  findOne: jest.fn(async (_entity: unknown, query: any) => {
    if (query.id === 'customer-user-1') return { displayName: 'Customer One', email: 'customer@example.com' }
    if (query.id) {
      return Array.from(orgs.values()).find((org) => (
        org.id === query.id
        && (!query.slug || org.slug === query.slug)
      )) ?? null
    }
    if (query.slug) return orgs.get(query.slug) ?? null
    return null
  }),
}

const mockCustomerRbac = {
  userHasAllFeatures: jest.fn(async () => true),
}

const mockFeatureToggles = {
  getBoolConfig: jest.fn(async () => ({ ok: true, value: true })),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (key: string) => {
      if (key === 'em') return mockEm
      if (key === 'customerRbacService') return mockCustomerRbac
      if (key === 'featureTogglesService') return mockFeatureToggles
      return null
    },
  })),
}))

import FrontendLayout from '../layout'
import SiteCatchAll from '../[...slug]/page'

const customerAuth = {
  sub: 'customer-user-1',
  sid: 'session-1',
  type: 'customer' as const,
  tenantId: 'tenant-1',
  orgId: 'org-a-id',
  email: 'customer@example.com',
  displayName: 'Customer One',
  customerEntityId: null,
  personEntityId: null,
  resolvedFeatures: ['portal.dashboard.view'],
}

describe('frontend customer portal org binding', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    headerStore.get.mockReturnValue('/org-b/portal/dashboard')
    mockGetCustomerAuthFromCookies.mockResolvedValue(customerAuth)
  })

  it('denies protected portal page access when URL org does not match the customer JWT org', async () => {
    await SiteCatchAll({
      params: Promise.resolve({ slug: ['org-b', 'portal', 'dashboard'] }),
    })

    expect(routeLoad).not.toHaveBeenCalled()
    expect(mockCustomerRbac.userHasAllFeatures).not.toHaveBeenCalled()
    expect(mockEm.findOne).toHaveBeenCalledWith(expect.any(Function), {
      id: 'org-a-id',
      slug: 'org-b',
      deletedAt: null,
    })
  })

  it('allows protected portal page access when URL org matches the customer JWT org', async () => {
    await SiteCatchAll({
      params: Promise.resolve({ slug: ['org-a', 'portal', 'dashboard'] }),
    })

    expect(routeLoad).toHaveBeenCalled()
    expect(mockCustomerRbac.userHasAllFeatures).toHaveBeenCalledWith(
      'customer-user-1',
      ['portal.dashboard.view'],
      { tenantId: 'tenant-1', organizationId: 'org-a-id' },
    )
    expect(mockEm.findOne).toHaveBeenCalledWith(expect.any(Function), {
      id: 'org-a-id',
      slug: 'org-a',
      deletedAt: null,
    })
  })

  it('renders authenticated organization chrome when URL org matches the customer JWT org', async () => {
    headerStore.get.mockReturnValue('/org-a/portal/dashboard')

    const element = await FrontendLayout({ children: <div>child</div> })
    renderToStaticMarkup(element as React.ReactElement)

    expect(portalShellMock).toHaveBeenCalledWith(expect.objectContaining({
      orgSlug: 'org-a',
      organizationId: 'org-a-id',
      tenantId: 'tenant-1',
      authenticated: true,
      userName: 'Customer One',
      userEmail: 'customer@example.com',
      customerAuth,
    }))
  })

  it('does not render mismatched organization chrome for authenticated protected portal routes', async () => {
    const element = await FrontendLayout({ children: <div>child</div> })
    renderToStaticMarkup(element as React.ReactElement)

    expect(portalShellMock).not.toHaveBeenCalled()
  })

  it.each(['/org-b/portal', '/org-b/portal/login', '/org-b/portal/signup', '/org-b/portal/verify', '/org-b/portal/reset-password'])(
    'keeps public route %s bound to the URL org even when another customer session exists',
    async (pathname) => {
      headerStore.get.mockReturnValue(pathname)

      const element = await FrontendLayout({ children: <div>public</div> })
      renderToStaticMarkup(element as React.ReactElement)

      expect(portalShellMock).toHaveBeenCalledWith(expect.objectContaining({
        orgSlug: 'org-b',
        organizationId: 'org-b-id',
        authenticated: false,
        userName: null,
        userEmail: null,
        customerAuth: null,
      }))
    },
  )
})
