/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const apiCallMock = jest.fn()
const routerReplaceMock = jest.fn()
const portalContextState: { tenant: unknown } = {
  tenant: { tenantId: 't-1', organizationId: 'o-1', organizationName: 'Acme', loading: false, error: null },
}
const searchParamsState: { token: string | null } = { token: 'invite-token-123' }

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
  useRouter: () => ({ replace: routerReplaceMock }),
  useSearchParams: () => ({ get: (key: string) => (key === 'token' ? searchParamsState.token : null) }),
}))

import PortalInvitePage from '../frontend/[orgSlug]/portal/invite/page'

describe('PortalInvitePage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    portalContextState.tenant = { tenantId: 't-1', organizationId: 'o-1', organizationName: 'Acme', loading: false, error: null }
    searchParamsState.token = 'invite-token-123'
  })

  const fillForm = (
    getByLabelText: (matcher: string) => HTMLElement,
    displayName = 'Buyer User',
    password = 'pw12345678',
    confirm = 'pw12345678',
  ) => {
    fireEvent.change(getByLabelText('Display Name'), { target: { value: displayName } })
    fireEvent.change(getByLabelText('Password'), { target: { value: password } })
    fireEvent.change(getByLabelText('Confirm Password'), { target: { value: confirm } })
  }

  it('submits the invite token, password, and displayName to the accept API and redirects to dashboard', async () => {
    apiCallMock.mockResolvedValueOnce({ ok: true, status: 200, result: { ok: true } })

    const { getByLabelText, getByRole } = renderWithProviders(<PortalInvitePage params={{ orgSlug: 'acme' }} />)
    fillForm(getByLabelText)
    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'Accept Invitation' }))
    })

    await waitFor(() => expect(apiCallMock).toHaveBeenCalled())
    expect(apiCallMock).toHaveBeenCalledWith(
      '/api/customer_accounts/invitations/accept',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          token: 'invite-token-123',
          password: 'pw12345678',
          displayName: 'Buyer User',
        }),
      }),
    )
    expect(routerReplaceMock).toHaveBeenCalledWith('/acme/portal/dashboard')
  })

  it('renders the no-token error and disables the form when ?token= is missing', async () => {
    searchParamsState.token = null

    const { getByLabelText, getByRole, findByText } = renderWithProviders(<PortalInvitePage params={{ orgSlug: 'acme' }} />)

    await findByText(/invalid or missing invitation token/i)
    expect((getByLabelText('Display Name') as HTMLInputElement).disabled).toBe(true)
    expect((getByLabelText('Password') as HTMLInputElement).disabled).toBe(true)
    expect((getByLabelText('Confirm Password') as HTMLInputElement).disabled).toBe(true)
    expect((getByRole('button', { name: 'Accept Invitation' }) as HTMLButtonElement).disabled).toBe(true)
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('blocks submission when display name is blank', async () => {
    const { getByLabelText, getByRole, findByText } = renderWithProviders(<PortalInvitePage params={{ orgSlug: 'acme' }} />)
    fillForm(getByLabelText, '  ')
    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'Accept Invitation' }))
    })

    await findByText(/display name is required/i)
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('blocks submission and surfaces a mismatch error when passwords do not match', async () => {
    const { getByLabelText, getByRole, findByText } = renderWithProviders(<PortalInvitePage params={{ orgSlug: 'acme' }} />)
    fillForm(getByLabelText, 'Buyer User', 'pw12345678', 'different1')
    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'Accept Invitation' }))
    })

    await findByText(/passwords do not match/i)
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('renders invalid-token message on HTTP 400', async () => {
    apiCallMock.mockResolvedValueOnce({ ok: false, status: 400, result: { ok: false, error: 'Invalid or expired invitation' } })

    const { getByLabelText, getByRole, findByText } = renderWithProviders(<PortalInvitePage params={{ orgSlug: 'acme' }} />)
    fillForm(getByLabelText)
    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'Accept Invitation' }))
    })

    await findByText(/invalid or expired invitation/i)
  })
})
