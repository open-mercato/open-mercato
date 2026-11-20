/** @jest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createFallbackTranslator } from '@open-mercato/shared/lib/i18n/translate'
import en from '../../../../../i18n/en.json'
import pl from '../../../../../i18n/pl.json'
import SsoConfigDetailPage from '../page'

const mockApiCall = jest.fn()
const mockApiCallOrThrow = jest.fn()
const mockRunMutation = jest.fn(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
const mockRetry = jest.fn()
let mockCreated = false
let mockTranslate = createFallbackTranslator(en)

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(mockCreated ? 'created=1' : ''),
}))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  apiCallOrThrow: (...args: unknown[]) => mockApiCallOrThrow(...args),
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: mockRunMutation, retryLastMutation: mockRetry }),
}))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/forms', () => ({
  FormHeader: ({ actionsContent }: { actionsContent: React.ReactNode }) => <header>{actionsContent}</header>,
}))
jest.mock('@open-mercato/ui/backend/detail', () => ({
  ErrorMessage: jest.requireActual('@open-mercato/ui/backend/detail/ErrorMessage').ErrorMessage,
  LoadingMessage: () => <p>Loading</p>,
  RecordNotFoundState: () => null,
}))

const config = {
  id: 'config-id', name: 'Example SSO', protocol: 'oidc', issuer: 'https://10.1.2.3.nip.io',
  clientId: 'client', hasClientSecret: true, allowedDomains: ['example.com'],
  jitEnabled: false, autoLinkByEmail: false, isActive: false, appRoleMappings: {},
}

describe('SSO activation feedback', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreated = false
    mockTranslate = createFallbackTranslator(en)
    mockApiCall.mockResolvedValue({ ok: true, result: config })
  })
  afterEach(cleanup)

  it.each([false, true])('shows discovery refusal independently of the creation banner (created=%s)', async (created) => {
    mockCreated = created
    const message = 'Cannot activate — discovery failed: OIDC endpoint must resolve only to public IP addresses'
    mockApiCallOrThrow.mockRejectedValue(new Error(message))
    render(<SsoConfigDetailPage params={{ id: config.id }} />)

    fireEvent.click(await screen.findByRole('button', { name: created ? 'Activate Now' : 'Activate', exact: true }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(message)
    expect(screen.getAllByText(message)).toHaveLength(1)
    expect(mockRunMutation).toHaveBeenCalled()
    expect(mockApiCallOrThrow).toHaveBeenCalledWith(
      '/api/sso/config/config-id/activate',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ active: true }) }),
      expect.objectContaining({ errorMessage: 'Failed to update activation status' }),
    )
  })

  it('shows a translated fallback for unknown failures', async () => {
    mockTranslate = createFallbackTranslator(pl)
    mockApiCallOrThrow.mockRejectedValue(null)
    render(<SsoConfigDetailPage params={{ id: config.id }} />)
    fireEvent.click(await screen.findByRole('button', { name: pl['sso.admin.action.activate'], exact: true }))
    expect((await screen.findByRole('alert')).textContent).toContain(pl['sso.admin.error.activationFailed'])
  })

  it('shows the missing-domain message and opens the domains tab for a translated server error', async () => {
    mockTranslate = createFallbackTranslator(pl)
    mockApiCall.mockResolvedValue({ ok: true, result: { ...config, allowedDomains: [] } })
    mockApiCallOrThrow.mockRejectedValue(new Error(pl['sso.admin.error.noDomainsForActivation']))
    render(<SsoConfigDetailPage params={{ id: config.id }} />)
    fireEvent.click(await screen.findByRole('button', { name: pl['sso.admin.action.activate'], exact: true }))
    expect((await screen.findByRole('alert')).textContent).toContain(pl['sso.admin.error.noDomainsForActivation'])
    expect(screen.getByText(pl['sso.admin.domains.empty'])).toBeTruthy()
  })

  it('clears a previous failure after a successful retry', async () => {
    mockApiCallOrThrow.mockRejectedValueOnce(new Error('Issuer blocked')).mockResolvedValueOnce({})
    render(<SsoConfigDetailPage params={{ id: config.id }} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Activate', exact: true }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Activate', exact: true }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(mockApiCallOrThrow).toHaveBeenCalledTimes(2)
  })
})
