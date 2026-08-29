/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { PortalShell } from '../PortalShell'
import { PortalProvider } from '../PortalContext'
import { PortalLayoutShell } from '../PortalLayoutShell'

const apiCallMock = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

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
  usePathname: () => '/acme/portal/orders',
}))

jest.mock('../../backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('../hooks/usePortalInjectedMenuItems', () => ({
  usePortalInjectedMenuItems: () => ({
    items: [],
    isLoading: false,
  }),
}))

jest.mock('../hooks/usePortalEventBridge', () => ({
  usePortalEventBridge: jest.fn(),
}))

jest.mock('../components/PortalNotificationBell', () => ({
  PortalNotificationBell: () => null,
}))

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

beforeEach(() => {
  apiCallMock.mockReset()
})

describe('PortalShell', () => {
  it('shows a loading skeleton until the portal nav payload arrives', async () => {
    const deferred = createDeferred<{
      ok: boolean
      result: {
        ok: boolean
        groups: Array<{
          id: string
          items: Array<{ id: string; label: string; href: string }>
        }>
      }
    }>()

    apiCallMock.mockReturnValueOnce(deferred.promise)

    render(
      <PortalShell
        authenticated
        orgSlug="acme"
        organizationName="Acme"
        userName="Ada Lovelace"
        userEmail="ada@example.com"
        onLogout={jest.fn()}
      >
        <div>Portal content</div>
      </PortalShell>,
    )

    await waitFor(() => {
      expect(apiCallMock).toHaveBeenCalledWith('/api/customer_accounts/portal/nav')
    })

    expect(screen.getByTestId('portal-nav-loading')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Orders' })).not.toBeInTheDocument()

    await act(async () => {
      deferred.resolve({
        ok: true,
        result: {
          ok: true,
          groups: [
            {
              id: 'main',
              items: [
                {
                  id: 'orders',
                  label: 'Orders',
                  href: '/acme/portal/orders',
                },
              ],
            },
          ],
        },
      })
      await deferred.promise
    })

    await waitFor(() => {
      expect(screen.queryByTestId('portal-nav-loading')).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Orders' })).toHaveAttribute('href', '/acme/portal/orders')
    })
  })

  it('does not keep an empty nav section visible when the payload has no items', async () => {
    apiCallMock.mockResolvedValueOnce({
      ok: true,
      result: {
        ok: true,
        groups: [],
      },
    })

    render(
      <PortalShell
        authenticated
        orgSlug="acme"
        organizationName="Acme"
        onLogout={jest.fn()}
      >
        <div>Portal content</div>
      </PortalShell>,
    )

    await waitFor(() => {
      expect(apiCallMock).toHaveBeenCalledWith('/api/customer_accounts/portal/nav')
    })

    await waitFor(() => {
      expect(screen.queryByTestId('portal-nav-loading')).not.toBeInTheDocument()
    })

    expect(screen.queryByRole('navigation', { name: 'Portal navigation' })).not.toBeInTheDocument()
  })

  // The layout that supplies `authenticated` sits above the [...slug] segment, so a
  // client-side navigation leaves a stale `false` behind. Trusting it painted the
  // logged-out header over authenticated content (#5678).
  it('renders the authenticated chrome when the context holds a user and the prop says otherwise', async () => {
    apiCallMock.mockImplementation(async (url: string) => {
      if (url === '/api/customer_accounts/portal/profile') {
        return {
          ok: true,
          status: 200,
          result: {
            ok: true,
            user: {
              id: 'customer-1',
              email: 'ada@example.com',
              displayName: 'Ada Lovelace',
              emailVerified: true,
              customerEntityId: null,
              personEntityId: null,
              isActive: true,
              lastLoginAt: null,
              createdAt: '',
            },
            roles: [],
            resolvedFeatures: [],
            isPortalAdmin: false,
          },
        }
      }
      return { ok: true, status: 200, result: { ok: true, groups: [] } }
    })

    render(
      <PortalProvider
        orgSlug="acme"
        initialAuth={{
          sub: 'customer-1',
          sid: 'session-1',
          type: 'customer',
          tenantId: 'tenant-1',
          orgId: 'org-1',
          email: 'ada@example.com',
          displayName: 'Ada Lovelace',
          customerEntityId: null,
          personEntityId: null,
          resolvedFeatures: [],
        } as any}
        initialTenant={{ tenantId: 'tenant-1', organizationId: 'org-1', organizationName: 'Acme' }}
      >
        <PortalShell authenticated={false} orgSlug="acme" organizationName="Acme">
          <div>Portal content</div>
        </PortalShell>
      </PortalProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('portal-nav-ready')).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: 'Log Out' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Log In' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Sign Up' })).not.toBeInTheDocument()
  })

  it('keeps the public chrome when no context user backs the prop', async () => {
    render(
      <PortalShell authenticated={false} orgSlug="acme" organizationName="Acme">
        <div>Portal content</div>
      </PortalShell>,
    )

    expect(screen.getByRole('link', { name: 'Log In' })).toHaveAttribute('href', '/acme/portal/login')
    expect(screen.queryByTestId('portal-nav-ready')).not.toBeInTheDocument()
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  // The composed path — the real props the (frontend) layout passes for an auth
  // route — is the seam where the two halves of the #5678 fix meet. Withholding
  // the session there is what keeps the context from upgrading the chrome.
  it('renders the public chrome for the props the layout passes on an auth route', async () => {
    render(
      <PortalLayoutShell
        orgSlug="acme"
        organizationName="Acme"
        tenantId="tenant-1"
        organizationId="org-1"
        authenticated={false}
        userName={null}
        userEmail={null}
        customerAuth={null}
      >
        <div>Login form</div>
      </PortalLayoutShell>,
    )

    expect(screen.getByRole('link', { name: 'Log In' })).toHaveAttribute('href', '/acme/portal/login')
    expect(screen.getByRole('link', { name: 'Sign Up' })).toHaveAttribute('href', '/acme/portal/signup')
    expect(screen.queryByTestId('portal-nav-ready')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Log Out' })).not.toBeInTheDocument()

    // Neither the portal nav nor the profile endpoint may be reached from a
    // public page: PortalProvider treats a null `customerAuth` as "server
    // confirmed: no session" and skips its enrichment fetch entirely.
    await waitFor(() => {
      expect(apiCallMock).not.toHaveBeenCalled()
    })
  })

  it('renders the authenticated chrome for the props the layout passes on a signed-in route', async () => {
    apiCallMock.mockResolvedValue({ ok: true, status: 200, result: { ok: true, groups: [] } })

    render(
      <PortalLayoutShell
        orgSlug="acme"
        organizationName="Acme"
        tenantId="tenant-1"
        organizationId="org-1"
        authenticated
        userName="Ada Lovelace"
        userEmail="ada@example.com"
        customerAuth={{
          sub: 'customer-1',
          sid: 'session-1',
          type: 'customer',
          tenantId: 'tenant-1',
          orgId: 'org-1',
          email: 'ada@example.com',
          displayName: 'Ada Lovelace',
          customerEntityId: null,
          personEntityId: null,
          resolvedFeatures: [],
        } as any}
      >
        <div>Dashboard</div>
      </PortalLayoutShell>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('portal-nav-ready')).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: 'Log Out' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Log In' })).not.toBeInTheDocument()
  })
})
