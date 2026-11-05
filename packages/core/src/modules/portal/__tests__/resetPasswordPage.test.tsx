/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const apiCallMock = jest.fn()
const portalContextState: { tenant: any } = { tenant: { tenantId: 't-1', organizationId: 'o-1', organizationName: 'Acme', loading: false, error: null } }
const searchParamsState: { token: string | null } = { token: 'reset-token-123' }

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

jest.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (key: string) => (key === 'token' ? searchParamsState.token : null) }),
}))

import PortalResetPasswordPage from '../frontend/[orgSlug]/portal/reset-password/page'

describe('PortalResetPasswordPage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    portalContextState.tenant = { tenantId: 't-1', organizationId: 'o-1', organizationName: 'Acme', loading: false, error: null }
    searchParamsState.token = 'reset-token-123'
  })

  const fillForm = (
    getByLabelText: (matcher: any) => HTMLElement,
    password: string,
    confirm: string,
  ) => {
    fireEvent.change(getByLabelText('New Password'), { target: { value: password } })
    fireEvent.change(getByLabelText('Confirm New Password'), { target: { value: confirm } })
  }

  it('submits token + new password to /api/customer_accounts/password/reset-confirm and renders success view', async () => {
    apiCallMock.mockResolvedValueOnce({ ok: true, status: 200, result: { ok: true } })

    const { getByLabelText, getByRole, findByText } = renderWithProviders(<PortalResetPasswordPage params={{ orgSlug: 'acme' }} />)
    fillForm(getByLabelText, 'pw12345678', 'pw12345678')
    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'Reset Password' }))
    })

    await waitFor(() => expect(apiCallMock).toHaveBeenCalled())
    expect(apiCallMock).toHaveBeenCalledWith(
      '/api/customer_accounts/password/reset-confirm',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: 'reset-token-123', password: 'pw12345678' }),
      }),
    )
    await findByText(/password reset complete/i)
  })

  it('renders the invalid-token message on HTTP 400', async () => {
    apiCallMock.mockResolvedValueOnce({ ok: false, status: 400, result: { ok: false, error: 'Invalid or expired token' } })

    const { getByLabelText, getByRole, findByText } = renderWithProviders(<PortalResetPasswordPage params={{ orgSlug: 'acme' }} />)
    fillForm(getByLabelText, 'pw12345678', 'pw12345678')
    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'Reset Password' }))
    })

    await findByText(/invalid or expired reset token/i)
  })

  it('surfaces backend error verbatim on non-400 failure', async () => {
    apiCallMock.mockResolvedValueOnce({ ok: false, status: 500, result: { ok: false, error: 'Backend on fire' } })

    const { getByLabelText, getByRole, findByText } = renderWithProviders(<PortalResetPasswordPage params={{ orgSlug: 'acme' }} />)
    fillForm(getByLabelText, 'pw12345678', 'pw12345678')
    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'Reset Password' }))
    })

    await findByText(/backend on fire/i)
  })

  it('renders generic error when apiCall throws', async () => {
    apiCallMock.mockRejectedValueOnce(new Error('network'))

    const { getByLabelText, getByRole, findByText } = renderWithProviders(<PortalResetPasswordPage params={{ orgSlug: 'acme' }} />)
    fillForm(getByLabelText, 'pw12345678', 'pw12345678')
    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'Reset Password' }))
    })

    await findByText(/password reset failed/i)
  })

  it('renders the noToken error and disables the form when ?token= is missing', async () => {
    searchParamsState.token = null

    const { getByLabelText, getByRole, findByText } = renderWithProviders(<PortalResetPasswordPage params={{ orgSlug: 'acme' }} />)

    await findByText(/invalid or missing reset token/i)
    expect((getByLabelText('New Password') as HTMLInputElement).disabled).toBe(true)
    expect((getByLabelText('Confirm New Password') as HTMLInputElement).disabled).toBe(true)
    expect((getByRole('button', { name: 'Reset Password' }) as HTMLButtonElement).disabled).toBe(true)
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('blocks submission and surfaces a mismatch error when passwords do not match', async () => {
    const { getByLabelText, getByRole, findByText } = renderWithProviders(<PortalResetPasswordPage params={{ orgSlug: 'acme' }} />)
    fillForm(getByLabelText, 'pw12345678', 'different1')
    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'Reset Password' }))
    })

    await findByText(/passwords do not match/i)
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('blocks submission when password is shorter than 8 characters', async () => {
    const { getByLabelText, getByRole, findByText } = renderWithProviders(<PortalResetPasswordPage params={{ orgSlug: 'acme' }} />)
    fillForm(getByLabelText, 'short', 'short')
    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'Reset Password' }))
    })

    await findByText(/at least 8 characters/i)
    expect(apiCallMock).not.toHaveBeenCalled()
  })
})
