/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import OrganizationBrandingPage from '../page'
import { QueryClient } from '@tanstack/react-query'
import { emitOrganizationScopeChanged } from '@open-mercato/shared/lib/frontend/organizationEvents'

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

Object.defineProperty(URL, 'createObjectURL', {
  configurable: true,
  writable: true,
  value: jest.fn(() => 'blob:organization-logo-preview'),
})
Object.defineProperty(URL, 'revokeObjectURL', {
  configurable: true,
  writable: true,
  value: jest.fn(),
})

const dispatchEventSpy = jest.spyOn(window, 'dispatchEvent')
const createObjectUrlMock = URL.createObjectURL as jest.Mock
const revokeObjectUrlMock = URL.revokeObjectURL as jest.Mock

const brandingPayload = {
  organizationId: '22222222-2222-4222-8222-222222222222',
  organizationName: 'Acme',
  tenantId: '11111111-1111-4111-8111-111111111111',
  logoUrl: '/api/attachments/image/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/acme.png?width=320',
  logoPreserveAspectRatio: false,
}

beforeEach(() => {
  emitOrganizationScopeChanged({ organizationId: brandingPayload.organizationId, tenantId: brandingPayload.tenantId })
  readApiResultOrThrowMock.mockReset()
  apiCallOrThrowMock.mockReset()
  flashMock.mockReset()
  dispatchEventSpy.mockClear()
  createObjectUrlMock.mockClear()
  createObjectUrlMock.mockReturnValue('blob:organization-logo-preview')
  revokeObjectUrlMock.mockClear()
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
    expect(screen.getByRole('switch', { name: 'Keep the aspect ratio' })).toHaveAttribute('aria-checked', 'false')
  })

  it('clears pending edits and uploads when switching organizations with the same branding', async () => {
    renderWithProviders(<OrganizationBrandingPage />)
    const input = await screen.findByLabelText('Logo URL')
    fireEvent.change(input, { target: { value: 'https://example.com/unsaved.svg' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Keep the aspect ratio' }))
    fireEvent.change(screen.getByLabelText('Upload logo'), {
      target: { files: [new File(['logo'], 'pending.png', { type: 'image/png' })] },
    })
    readApiResultOrThrowMock.mockResolvedValue({
      ...brandingPayload,
      organizationId: '33333333-3333-4333-8333-333333333333',
      organizationName: 'Second organization',
    })

    act(() => emitOrganizationScopeChanged({
      organizationId: '33333333-3333-4333-8333-333333333333',
      tenantId: brandingPayload.tenantId,
    }))

    await screen.findByText('Second organization')
    expect(screen.queryByText('Acme')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Logo URL')).toHaveValue(brandingPayload.logoUrl)
    expect(screen.getByRole('switch', { name: 'Keep the aspect ratio' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('img')).toHaveAttribute('src', brandingPayload.logoUrl)
    expect(revokeObjectUrlMock).toHaveBeenCalledWith('blob:organization-logo-preview')
    fireEvent.click(screen.getByRole('button', { name: /Save branding/ }))
    await waitFor(() => expect(apiCallOrThrowMock).toHaveBeenCalled())
    expect(readApiResultOrThrowMock.mock.calls.some(([path]) => path === '/api/attachments')).toBe(false)
  })

  it('replaces branding with the single-organization prompt in All scope and recovers after selection', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderWithProviders(<OrganizationBrandingPage />, { queryClient })
    await screen.findByText('Acme')
    readApiResultOrThrowMock.mockRejectedValue(new Error('Select a single organization before changing sidebar branding.'))

    act(() => emitOrganizationScopeChanged({ organizationId: null, tenantId: brandingPayload.tenantId }))

    expect(screen.queryByText('Acme')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Save branding/ })).not.toBeInTheDocument()
    await screen.findByText('Select a single organization before changing sidebar branding.')
    readApiResultOrThrowMock.mockResolvedValue(brandingPayload)
    act(() => emitOrganizationScopeChanged({ organizationId: brandingPayload.organizationId, tenantId: brandingPayload.tenantId }))
    await screen.findByText('Acme')
    expect(screen.getByLabelText('Logo URL')).toHaveValue(brandingPayload.logoUrl)
    expect(apiCallOrThrowMock).not.toHaveBeenCalled()
  })

  it('does not save a completed upload into a newly selected organization', async () => {
    let finishUpload!: (payload: { item: { url: string } }) => void
    renderWithProviders(<OrganizationBrandingPage />)
    await screen.findByText('Acme')
    fireEvent.change(screen.getByLabelText('Upload logo'), {
      target: { files: [new File(['logo'], 'pending.png', { type: 'image/png' })] },
    })
    readApiResultOrThrowMock.mockImplementationOnce(() => new Promise((resolve) => {
      finishUpload = resolve
    }))
    fireEvent.click(screen.getByRole('button', { name: /Save branding/ }))
    await waitFor(() => expect(readApiResultOrThrowMock).toHaveBeenCalledWith('/api/attachments', expect.anything(), expect.anything()))
    readApiResultOrThrowMock.mockResolvedValue({ ...brandingPayload, organizationName: 'Second organization' })
    act(() => emitOrganizationScopeChanged({ organizationId: '33333333-3333-4333-8333-333333333333', tenantId: brandingPayload.tenantId }))
    await screen.findByText('Second organization')
    fireEvent.change(screen.getByLabelText('Logo URL'), { target: { value: 'https://example.com/second-unsaved.svg' } })
    await act(async () => finishUpload({ item: { url: '/api/attachments/file/previous-logo.png' } }))

    expect(apiCallOrThrowMock).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Logo URL')).toHaveValue('https://example.com/second-unsaved.svg')
    expect(flashMock).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Save branding/ })).toBeEnabled()
  })

  it('does not display an earlier scope response after the organization changes', async () => {
    let resolveEarlierRequest!: (payload: typeof brandingPayload) => void
    readApiResultOrThrowMock.mockImplementationOnce(() => new Promise<typeof brandingPayload>((resolve) => {
      resolveEarlierRequest = resolve
    }))
    renderWithProviders(<OrganizationBrandingPage />)
    await waitFor(() => expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(1))
    readApiResultOrThrowMock.mockResolvedValue({ ...brandingPayload, organizationName: 'Second organization' })

    act(() => emitOrganizationScopeChanged({ organizationId: '33333333-3333-4333-8333-333333333333', tenantId: brandingPayload.tenantId }))
    await screen.findByText('Second organization')
    await act(async () => resolveEarlierRequest(brandingPayload))

    expect(screen.getByText('Second organization')).toBeInTheDocument()
    expect(screen.queryByText('Acme')).not.toBeInTheDocument()
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
          body: JSON.stringify({
            logoUrl: 'https://example.com/logo.svg',
            logoPreserveAspectRatio: false,
          }),
        }),
        expect.anything(),
      )
    })
    expect(dispatchEventSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'om:refresh-sidebar' }))
    expect(flashMock).toHaveBeenCalledWith('Organization branding updated', 'success')
  })

  it('saves the aspect-ratio preference when enabled', async () => {
    renderWithProviders(<OrganizationBrandingPage />)

    const input = await screen.findByLabelText('Logo URL')
    fireEvent.change(input, { target: { value: 'https://example.com/logo.svg' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Keep the aspect ratio' }))
    fireEvent.click(screen.getByRole('button', { name: /Save branding/ }))

    await waitFor(() => {
      expect(apiCallOrThrowMock).toHaveBeenCalledWith(
        '/api/directory/organization-branding',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            logoUrl: 'https://example.com/logo.svg',
            logoPreserveAspectRatio: true,
          }),
        }),
        expect.anything(),
      )
    })
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
          body: JSON.stringify({
            logoUrl: null,
            logoPreserveAspectRatio: false,
          }),
        }),
        expect.anything(),
      )
    })
  })

  it.each([
    ['png', 'image/png'],
    ['jpg', 'image/jpeg'],
    ['webp', 'image/webp'],
  ])('uploads a selected %s logo file without storing the square thumbnail', async (extension, mimeType) => {
    const attachmentId = `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb${extension === 'png' ? 'c' : extension === 'jpg' ? 'd' : 'e'}`
    const fileUrl = `/api/attachments/file/${attachmentId}`

    readApiResultOrThrowMock
      .mockResolvedValueOnce(brandingPayload)
      .mockResolvedValueOnce({
        ok: true,
        item: {
          id: attachmentId,
          url: fileUrl,
          thumbnailUrl: `/api/attachments/image/${attachmentId}/acme.${extension}?width=320&height=320`,
        },
      })

    renderWithProviders(<OrganizationBrandingPage />)

    const input = await screen.findByLabelText('Upload logo')
    const file = new File(['logo'], `acme.${extension}`, { type: mimeType })
    fireEvent.change(input, { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: /Save branding/ }))

    await waitFor(() => {
      expect(readApiResultOrThrowMock).toHaveBeenCalledWith(
        '/api/attachments',
        expect.objectContaining({
          method: 'POST',
          body: expect.any(FormData),
        }),
        expect.anything(),
      )
    })
    expect(apiCallOrThrowMock).toHaveBeenCalledWith(
      '/api/directory/organization-branding',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          logoUrl: fileUrl,
          logoPreserveAspectRatio: false,
        }),
      }),
      expect.anything(),
    )
    expect(dispatchEventSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'om:refresh-sidebar' }))
  })

  it('keeps the selected file preview when the file picker is cancelled', async () => {
    readApiResultOrThrowMock.mockResolvedValueOnce({ ...brandingPayload, logoUrl: null })

    renderWithProviders(<OrganizationBrandingPage />)

    const input = await screen.findByLabelText('Upload logo')
    const file = new File(['logo'], 'acme.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByAltText('Acme logo preview')).toHaveAttribute('src', 'blob:organization-logo-preview')
    })

    fireEvent.change(input, { target: { files: [] } })

    expect(screen.getByAltText('Acme logo preview')).toHaveAttribute('src', 'blob:organization-logo-preview')
  })
})
