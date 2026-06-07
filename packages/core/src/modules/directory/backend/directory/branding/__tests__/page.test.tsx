/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import OrganizationBrandingPage from '../page'

const readApiResultOrThrowMock = jest.fn()
const apiCallOrThrowMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
  withScopedApiRequestHeaders: (
    _headers: Record<string, string>,
    operation: () => Promise<unknown>,
  ) => operation(),
}))

const flashMock = jest.fn()
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
  }),
}))

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  useInjectionSpotEvents: () => ({
    triggerEvent: jest.fn(async () => ({ ok: true, requestHeaders: {} })),
  }),
}))

jest.mock('@open-mercato/ui/backend/injection/mutationEvents', () => ({
  GLOBAL_MUTATION_INJECTION_SPOT_ID: 'backend-mutation:global',
  dispatchBackendMutationError: jest.fn(),
}))

const dispatchEventSpy = jest.spyOn(window, 'dispatchEvent')

const brandingPayload = {
  organizationId: '22222222-2222-4222-8222-222222222222',
  organizationName: 'Acme',
  tenantId: '11111111-1111-4111-8111-111111111111',
  logoUrl: '/api/attachments/image/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/acme.png?width=320',
}

beforeEach(() => {
  readApiResultOrThrowMock.mockReset()
  apiCallOrThrowMock.mockReset()
  flashMock.mockReset()
  dispatchEventSpy.mockClear()
  readApiResultOrThrowMock.mockResolvedValue(brandingPayload)
  apiCallOrThrowMock.mockResolvedValue({
    ok: true,
    status: 200,
    result: { ...brandingPayload, logoUrl: 'https://example.com/logo.svg' },
    response: {},
    cacheStatus: null,
  })
})

describe('OrganizationBrandingPage', () => {
  it('renders current organization branding', async () => {
    renderWithProviders(<OrganizationBrandingPage />)

    expect(await screen.findByText('Organization branding')).toBeInTheDocument()
    expect(screen.getByText('Acme')).toBeInTheDocument()
    expect(screen.getByLabelText('Logo URL')).toHaveValue(brandingPayload.logoUrl)
  })

  it('saves a pasted logo URL and refreshes the sidebar chrome', async () => {
    renderWithProviders(<OrganizationBrandingPage />)

    const input = await screen.findByLabelText('Logo URL')
    fireEvent.change(input, { target: { value: 'https://example.com/logo.svg' } })
    fireEvent.click(screen.getByRole('button', { name: /Save branding/ }))

    await waitFor(() => {
      expect(apiCallOrThrowMock).toHaveBeenCalledWith(
        '/api/directory/organization-branding',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ logoUrl: 'https://example.com/logo.svg' }),
        }),
        expect.anything(),
      )
    })
    expect(dispatchEventSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'om:refresh-sidebar' }))
    expect(flashMock).toHaveBeenCalledWith('Organization branding updated', 'success')
  })

  it('resets to the default logo', async () => {
    renderWithProviders(<OrganizationBrandingPage />)

    await screen.findByLabelText('Logo URL')
    fireEvent.click(screen.getByRole('button', { name: /Use default logo/ }))

    await waitFor(() => {
      expect(apiCallOrThrowMock).toHaveBeenCalledWith(
        '/api/directory/organization-branding',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ logoUrl: null }),
        }),
        expect.anything(),
      )
    })
  })
})
