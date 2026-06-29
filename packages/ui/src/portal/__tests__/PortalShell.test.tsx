/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { PortalShell } from '../PortalShell'

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
})
