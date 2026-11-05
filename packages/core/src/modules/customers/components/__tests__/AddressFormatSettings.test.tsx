/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import AddressFormatSettings from '../AddressFormatSettings'

const apiCallMock = jest.fn()
const runMutationMock = jest.fn(async ({ operation }: { operation: () => Promise<unknown> }) => operation())

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: (...args: unknown[]) => runMutationMock(...(args as [{ operation: () => Promise<unknown> }])),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

describe('AddressFormatSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    apiCallMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (!init || !init.method) {
        return { ok: true, result: { addressFormat: 'line_first' } }
      }
      return { ok: true, result: {} }
    })
  })

  it('routes the address-format toggle through the guarded mutation runner', async () => {
    renderWithProviders(<AddressFormatSettings />)

    await waitFor(() => {
      expect(apiCallMock).toHaveBeenCalledWith('/api/customers/settings/address-format')
    })

    fireEvent.click(await screen.findByLabelText(/Street-first/i))

    await waitFor(() => {
      expect(runMutationMock).toHaveBeenCalledTimes(1)
    })
    expect(runMutationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          resourceKind: 'customers.settings',
          retryLastMutation: expect.any(Function),
        }),
        mutationPayload: { addressFormat: 'street_first' },
      }),
    )
    expect(apiCallMock).toHaveBeenCalledWith(
      '/api/customers/settings/address-format',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ addressFormat: 'street_first' }),
      }),
    )
  })
})
