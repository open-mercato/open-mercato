/**
 * @jest-environment jsdom
 */

import type React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import SsoConfigDetailPage from '../backend/sso/config/[id]/page'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  apiCallOrThrow: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/ui/backend/forms', () => ({
  FormHeader: ({ title, actionsContent }: { title: string; actionsContent?: React.ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {actionsContent}
    </header>
  ),
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: ({ label }: { label: string }) => <div>{label}</div>,
  ErrorMessage: ({ label }: { label: string }) => <div>{label}</div>,
  RecordNotFoundState: ({ label }: { label: string }) => <div>{label}</div>,
}))

const apiCallMock = apiCall as jest.Mock
const apiCallOrThrowMock = apiCallOrThrow as jest.Mock
const flashMock = flash as jest.Mock

const CEILING_MESSAGE = 'You cannot grant a role or feature above your own permissions.'

const CONFIG = {
  id: 'config-1',
  name: 'Corporate IdP',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  protocol: 'oidc',
  issuer: 'https://idp.example.com',
  clientId: 'client-1',
  hasClientSecret: true,
  allowedDomains: ['example.com'],
  jitEnabled: false,
  autoLinkByEmail: true,
  isActive: false,
  ssoRequired: false,
  appRoleMappings: {},
  hasActiveScimTokens: false,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
}

function respond(result: unknown, status = 200) {
  return { ok: status < 400, status, result, response: {}, cacheStatus: null }
}

function refusal(message: string, status = 403) {
  return Object.assign(new Error(message), { status, error: message })
}

function renderPage() {
  return renderWithProviders(<SsoConfigDetailPage params={{ id: CONFIG.id }} />)
}

describe('SSO config detail page error surfacing', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    apiCallMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/auth/roles')) return respond({ items: [{ id: 'r1', name: 'admin' }, { id: 'r2', name: 'employee' }] })
      if (url.startsWith('/api/sso/scim/')) return respond({ items: [] })
      return respond(CONFIG)
    })
    apiCallOrThrowMock.mockRejectedValue(refusal(CEILING_MESSAGE))
  })

  it('shows the translated refusal when role mappings are rejected and keeps the edit marked unsaved', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Role Mappings' }))
    await waitFor(() => expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('admin'))
    fireEvent.change(screen.getByPlaceholderText('e.g. OpenMercato.Admin'), { target: { value: 'idp-admins' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByTestId('sso-role-mappings-unsaved').textContent).toBe('Unsaved changes')

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(flashMock).toHaveBeenCalledWith(CEILING_MESSAGE, 'error'))
    expect(screen.getByTestId('sso-role-mappings-save-error').textContent).toBe(CEILING_MESSAGE)
    expect(screen.getByText('idp-admins')).toBeTruthy()
    expect(screen.getByTestId('sso-role-mappings-unsaved')).toBeTruthy()
    expect(flashMock).not.toHaveBeenCalledWith('Role mappings saved', 'success')
  })

  it('shows the refusal for a General save and keeps the name change marked unsaved', async () => {
    renderPage()
    const nameInput = await screen.findByDisplayValue('Corporate IdP')
    fireEvent.change(nameInput, { target: { value: 'Renamed IdP' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(flashMock).toHaveBeenCalledWith(CEILING_MESSAGE, 'error'))
    expect(screen.getByTestId('sso-general-save-error').textContent).toBe(CEILING_MESSAGE)
    expect(screen.getByDisplayValue('Renamed IdP')).toBeTruthy()
    expect(screen.getByTestId('sso-general-unsaved')).toBeTruthy()
  })

  it('shows the refusal when activation is rejected from the header', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Activate' }))

    await waitFor(() => expect(flashMock).toHaveBeenCalledWith(CEILING_MESSAGE, 'error'))
    expect(screen.getByTestId('sso-activation-error').textContent).toBe(CEILING_MESSAGE)
  })

  it('shows the refusal when SCIM token generation is rejected', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Provisioning' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Generate Token' }))
    fireEvent.change(screen.getByPlaceholderText('Token name (e.g., Entra ID Production)'), { target: { value: 'Entra' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(flashMock).toHaveBeenCalledWith(CEILING_MESSAGE, 'error'))
  })

  it('falls back to the localized save failure when the server gives no message', async () => {
    apiCallOrThrowMock.mockRejectedValue(new Error(''))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))

    await waitFor(() => expect(flashMock).toHaveBeenCalledWith('Failed to save SSO configuration', 'error'))
  })
})
