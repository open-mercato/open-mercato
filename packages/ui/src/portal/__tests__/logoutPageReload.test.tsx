/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, render, waitFor } from '@testing-library/react'
import type { CustomerAuthContext } from '@open-mercato/shared/modules/customer-auth'
import { PortalProvider, usePortalContext } from '../PortalContext'
import { useCustomerAuth } from '../hooks/useCustomerAuth'

const apiCallMock = jest.fn()
const navigateWithPageReloadMock = jest.fn()
const routerPushMock = jest.fn()
const routerReplaceMock = jest.fn()

jest.mock('../../backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/shared/lib/navigation/pageReload', () => ({
  navigateWithPageReload: (...args: unknown[]) => navigateWithPageReloadMock(...args),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPushMock, replace: routerReplaceMock }),
}))

function makeAuth(): CustomerAuthContext {
  return {
    sub: 'user-1',
    email: 'user@example.com',
    displayName: 'User One',
    tenantId: 't-1',
    orgId: 'o-1',
    resolvedFeatures: ['portal.view'],
    customerEntityId: null,
    personEntityId: null,
  } as unknown as CustomerAuthContext
}

/**
 * The portal layout that computes `authenticated` and the customer session sits above the
 * `[...slug]` segment, so it only re-runs on a document load. Both logout paths must therefore
 * leave the authenticated side with a full page load; a client-side navigation would strand
 * authenticated chrome over the login page. See `navigateWithPageReload`.
 */
describe('portal logout crosses the auth boundary with a full page load', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    apiCallMock.mockResolvedValue({ ok: true, status: 200, result: { ok: true } })
    navigateWithPageReloadMock.mockReset()
    routerPushMock.mockReset()
    routerReplaceMock.mockReset()
  })

  describe('useCustomerAuth().logout', () => {
    function LogoutProbe({ orgSlug }: { orgSlug?: string }) {
      const { logout } = useCustomerAuth(orgSlug)
      return <button type="button" onClick={() => { void logout() }}>logout</button>
    }

    it('reloads the page onto the org-scoped login route', async () => {
      const { getByText } = render(<LogoutProbe orgSlug="acme" />)

      await act(async () => { getByText('logout').click() })

      await waitFor(() => {
        expect(navigateWithPageReloadMock).toHaveBeenCalledWith('/acme/portal/login')
      })
      expect(routerPushMock).not.toHaveBeenCalled()
      expect(routerReplaceMock).not.toHaveBeenCalled()
    })

    it('reloads the page onto the unscoped login route when no org slug is known', async () => {
      const { getByText } = render(<LogoutProbe />)

      await act(async () => { getByText('logout').click() })

      await waitFor(() => {
        expect(navigateWithPageReloadMock).toHaveBeenCalledWith('/portal/login')
      })
    })

    it('still reloads when the logout request fails', async () => {
      apiCallMock.mockRejectedValue(new Error('[internal] network down'))
      const { getByText } = render(<LogoutProbe orgSlug="acme" />)

      await act(async () => { getByText('logout').click() })

      await waitFor(() => {
        expect(navigateWithPageReloadMock).toHaveBeenCalledWith('/acme/portal/login')
      })
    })
  })

  describe('PortalContext logout', () => {
    function ContextLogoutProbe() {
      const { auth } = usePortalContext()
      return <button type="button" onClick={() => { void auth.logout() }}>logout</button>
    }

    it('reloads the page onto the login route', async () => {
      const { getByText } = render(
        <PortalProvider orgSlug="acme" initialAuth={makeAuth()}>
          <ContextLogoutProbe />
        </PortalProvider>,
      )

      await act(async () => { getByText('logout').click() })

      await waitFor(() => {
        expect(navigateWithPageReloadMock).toHaveBeenCalledWith('/acme/portal/login')
      })
      expect(routerPushMock).not.toHaveBeenCalled()
      expect(routerReplaceMock).not.toHaveBeenCalled()
    })
  })
})
