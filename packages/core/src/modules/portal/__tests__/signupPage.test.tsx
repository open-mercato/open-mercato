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

import PortalSignupPage from '../frontend/[orgSlug]/portal/signup/page'

describe('PortalSignupPage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    portalContextState.tenant = { tenantId: 't-1', organizationId: 'o-1', organizationName: 'Acme', loading: false, error: null }
  })

  function fillForm(getByLabelText: (matcher: RegExp) => HTMLElement) {
    fireEvent.change(getByLabelText(/full name/i), { target: { value: 'Jane Smith' } })
    fireEvent.change(getByLabelText(/email/i), { target: { value: 'jane@example.com' } })
    fireEvent.change(getByLabelText(/password/i), { target: { value: 'pw12345' } })
  }

  it('submits the signup payload with tenant + organization scope on 202 success', async () => {
    apiCallMock.mockResolvedValueOnce({ ok: true, status: 202, result: { ok: true } })

    const { getByLabelText, getByRole, findByText } = renderWithProviders(
      <PortalSignupPage params={{ orgSlug: 'acme' }} />,
    )
    fillForm(getByLabelText)
    await act(async () => {
      fireEvent.click(getByRole('button', { name: /create account|sign up/i }))
    })

    await waitFor(() => expect(apiCallMock).toHaveBeenCalled())
    expect(apiCallMock).toHaveBeenCalledWith(
      '/api/customer_accounts/signup',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'jane@example.com',
          password: 'pw12345',
          displayName: 'Jane Smith',
          tenantId: 't-1',
          organizationId: 'o-1',
        }),
      }),
    )
    // Renders the post-success state with the sign-in CTA
    await findByText(/account created/i)
  })

  it('treats non-202 responses as errors and renders the server message', async () => {
    apiCallMock.mockResolvedValueOnce({ ok: false, status: 400, result: { ok: false, error: 'Email already in use' } })

    const { getByLabelText, getByRole, findByText, queryByText } = renderWithProviders(
      <PortalSignupPage params={{ orgSlug: 'acme' }} />,
    )
    fillForm(getByLabelText)
    await act(async () => {
      fireEvent.click(getByRole('button', { name: /create account|sign up/i }))
    })

    await findByText(/email already in use/i)
    expect(queryByText(/account created/i)).toBeNull()
  })

  it('shows the org-not-found guard when tenant scope is missing and never calls the API', async () => {
    portalContextState.tenant = { tenantId: undefined, organizationId: undefined, organizationName: undefined, loading: false, error: null }

    const { getByLabelText, getByRole, findByText } = renderWithProviders(
      <PortalSignupPage params={{ orgSlug: 'acme' }} />,
    )
    fillForm(getByLabelText)
    await act(async () => {
      fireEvent.click(getByRole('button', { name: /create account|sign up/i }))
    })

    await findByText(/organization not found/i)
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('falls back to a generic error message when apiCall throws', async () => {
    apiCallMock.mockRejectedValueOnce(new Error('network'))

    const { getByLabelText, getByRole, findByText } = renderWithProviders(
      <PortalSignupPage params={{ orgSlug: 'acme' }} />,
    )
    fillForm(getByLabelText)
    await act(async () => {
      fireEvent.click(getByRole('button', { name: /create account|sign up/i }))
    })

    await findByText(/signup failed/i)
  })
})
