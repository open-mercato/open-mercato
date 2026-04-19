/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, render, waitFor } from '@testing-library/react'
import type { CustomerAuthContext } from '@open-mercato/shared/modules/customer-auth'
import { PortalProvider, usePortalContext } from '../PortalContext'

const apiCallMock = jest.fn()

jest.mock('../../backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

function ProfileProbe() {
  const { auth } = usePortalContext()
  return <div data-testid="profile-roles">{auth.roles.map((r) => r.slug).join(',')}</div>
}

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

describe('PortalProvider profile enrichment', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    apiCallMock.mockResolvedValue({
      ok: true,
      status: 200,
      result: {
        ok: true,
        user: {
          id: 'user-1',
          email: 'user@example.com',
          displayName: 'User One',
          emailVerified: true,
          customerEntityId: null,
          personEntityId: null,
          isActive: true,
          lastLoginAt: null,
          createdAt: '',
        },
        roles: [{ id: 'r-1', name: 'Buyer', slug: 'buyer' }],
        resolvedFeatures: ['portal.view'],
        isPortalAdmin: false,
      },
    })
  })

  it('fetches the profile exactly once when initialAuth reference changes across renders', async () => {
    const initialAuth = makeAuth()
    const { rerender, getByTestId } = render(
      <PortalProvider orgSlug="acme" initialAuth={initialAuth}>
        <ProfileProbe />
      </PortalProvider>,
    )

    await waitFor(() => {
      expect(getByTestId('profile-roles').textContent).toBe('buyer')
    })
    expect(apiCallMock).toHaveBeenCalledTimes(1)

    // Simulate a portal navigation: server layout re-renders and produces a
    // fresh `initialAuth` object with the same content. With the ref guard the
    // effect MUST NOT re-fetch, otherwise we'd page-flash on every nav.
    await act(async () => {
      rerender(
        <PortalProvider orgSlug="acme" initialAuth={makeAuth()}>
          <ProfileProbe />
        </PortalProvider>,
      )
    })

    expect(apiCallMock).toHaveBeenCalledTimes(1)
  })

  it('does not fetch the profile when server confirms no auth', async () => {
    render(
      <PortalProvider orgSlug="acme" initialAuth={null}>
        <ProfileProbe />
      </PortalProvider>,
    )
    // Flush effects
    await act(async () => {})
    expect(apiCallMock).not.toHaveBeenCalled()
  })
})
