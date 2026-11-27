/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import '@testing-library/jest-dom'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import ConnectGmailWidget from '../widget.client'

const mockApiCall = jest.fn()
const mockRunMutation = jest.fn()
let mockFeatures: string[]

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: { grantedFeatures: mockFeatures } }),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: mockRunMutation, retryLastMutation: jest.fn() }),
}))

const statusPath = '/api/communication_channels/oauth/gmail/status'

describe('Connect Gmail provider readiness', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
    mockRunMutation.mockReset()
    mockFeatures = []
  })

  it('disables an unconfigured provider and shows the setup link for integration managers', async () => {
    mockFeatures = ['integrations.view', 'integrations.manage']
    mockApiCall.mockResolvedValue({ ok: true, result: { configured: false } })

    renderWithProviders(<ConnectGmailWidget data={{}} context={{}} />)

    const connect = screen.getByRole('button', { name: 'Connect Gmail' })
    expect(connect).toBeDisabled()
    const setupLink = await screen.findByRole('link', { name: 'Open provider setup' })
    expect(setupLink).toHaveAttribute('href', '/backend/integrations/channel_gmail')
    expect(connect).toBeDisabled()
    fireEvent.click(connect)
    expect(mockRunMutation).not.toHaveBeenCalled()
    expect(mockApiCall).toHaveBeenCalledWith(statusPath, expect.objectContaining({ cache: 'no-store' }))
  })

  it('retries a failed status check and enables the configured provider', async () => {
    mockApiCall.mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce({ ok: true, result: { configured: true } })

    renderWithProviders(<ConnectGmailWidget data={{}} context={{}} />)

    expect(await screen.findByText('Could not check provider setup.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Connect Gmail' })).toBeEnabled())
  })

  it('uses guarded OAuth and gives mailbox owners guidance when setup disappears before initiation', async () => {
    mockApiCall.mockResolvedValue({ ok: true, result: { configured: true } })
    mockRunMutation.mockResolvedValue({ ok: false, result: { code: 'oauth_client_not_configured' } })

    renderWithProviders(<ConnectGmailWidget data={{}} context={{}} />)

    const connect = screen.getByRole('button', { name: 'Connect Gmail' })
    await waitFor(() => expect(connect).toBeEnabled())
    fireEvent.click(connect)

    expect(await screen.findByText(/Ask an administrator/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open provider setup' })).not.toBeInTheDocument()
    expect(mockRunMutation).toHaveBeenCalledWith(expect.objectContaining({
      mutationPayload: { providerKey: 'gmail' },
      operation: expect.any(Function),
    }))
    expect(connect).toBeDisabled()
  })
})
