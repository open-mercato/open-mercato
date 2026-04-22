/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const apiCallMock = jest.fn()
const portalContextState: { tenant: any } = { tenant: { tenantId: 't-1', organizationId: 'o-1', organizationName: 'Acme', loading: false, error: null } }

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/ui/portal/PortalContext', () => ({
  usePortalContext: () => portalContextState,
}))

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  InjectionSpot: () => null,
}))

jest.mock('@open-mercato/ui/backend/injection/spotIds', () => ({
  PortalInjectionSpots: { pageBefore: () => 'before', pageAfter: () => 'after' },
}))

import PortalLoginPage from '../frontend/[orgSlug]/portal/login/page'

describe('PortalLoginPage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    portalContextState.tenant = { tenantId: 't-1', organizationId: 'o-1', organizationName: 'Acme', loading: false, error: null }
  })

  it('submits credentials + tenantId to /api/customer_accounts/login on success', async () => {
    apiCallMock.mockResolvedValueOnce({ ok: true, status: 200, result: { ok: true } })

    const { getByLabelText, getByRole, queryByText } = renderWithProviders(<PortalLoginPage params={{ orgSlug: 'acme' }} />)
    fireEvent.change(getByLabelText(/email/i), { target: { value: 'u@example.com' } })
    fireEvent.change(getByLabelText(/password/i), { target: { value: 'pw12345' } })
    await act(async () => {
      fireEvent.click(getByRole('button', { name: /sign in/i }))
    })

    await waitFor(() => expect(apiCallMock).toHaveBeenCalled())
    expect(apiCallMock).toHaveBeenCalledWith(
      '/api/customer_accounts/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'u@example.com', password: 'pw12345', tenantId: 't-1' }),
      }),
    )
    // No error rendered on success — the page issues a navigation we don't assert
    // here (jsdom Location replacement is brittle); negative-path tests cover the
    // error-rendering branches.
    expect(queryByText(/invalid email or password/i)).toBeNull()
    expect(queryByText(/account locked/i)).toBeNull()
  })

  it('renders the locked-account message on HTTP 423', async () => {
    apiCallMock.mockResolvedValueOnce({ ok: false, status: 423, result: { ok: false, error: 'locked' } })

    const { getByLabelText, getByRole, findByText } = renderWithProviders(<PortalLoginPage params={{ orgSlug: 'acme' }} />)
    fireEvent.change(getByLabelText(/email/i), { target: { value: 'u@example.com' } })
    fireEvent.change(getByLabelText(/password/i), { target: { value: 'pw' } })
    await act(async () => {
      fireEvent.click(getByRole('button', { name: /sign in/i }))
    })

    await findByText(/account locked/i)
  })

  it('renders the invalid-credentials message on HTTP 401', async () => {
    apiCallMock.mockResolvedValueOnce({ ok: false, status: 401, result: { ok: false, error: 'nope' } })

    const { getByLabelText, getByRole, findByText } = renderWithProviders(<PortalLoginPage params={{ orgSlug: 'acme' }} />)
    fireEvent.change(getByLabelText(/email/i), { target: { value: 'u@example.com' } })
    fireEvent.change(getByLabelText(/password/i), { target: { value: 'pw' } })
    await act(async () => {
      fireEvent.click(getByRole('button', { name: /sign in/i }))
    })

    await findByText(/invalid email or password/i)
  })

  it('shows the org-not-found guard when tenantId is missing and never calls the API', async () => {
    portalContextState.tenant = { tenantId: undefined, organizationId: undefined, organizationName: undefined, loading: false, error: null }

    const { getByLabelText, getByRole, findByText } = renderWithProviders(<PortalLoginPage params={{ orgSlug: 'acme' }} />)
    fireEvent.change(getByLabelText(/email/i), { target: { value: 'u@example.com' } })
    fireEvent.change(getByLabelText(/password/i), { target: { value: 'pw' } })
    await act(async () => {
      fireEvent.click(getByRole('button', { name: /sign in/i }))
    })

    await findByText(/organization not found/i)
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('renders a generic error when apiCall throws', async () => {
    apiCallMock.mockRejectedValueOnce(new Error('network'))

    const { getByLabelText, getByRole, findByText } = renderWithProviders(<PortalLoginPage params={{ orgSlug: 'acme' }} />)
    fireEvent.change(getByLabelText(/email/i), { target: { value: 'u@example.com' } })
    fireEvent.change(getByLabelText(/password/i), { target: { value: 'pw' } })
    await act(async () => {
      fireEvent.click(getByRole('button', { name: /sign in/i }))
    })

    await findByText(/login failed/i)
  })
})
