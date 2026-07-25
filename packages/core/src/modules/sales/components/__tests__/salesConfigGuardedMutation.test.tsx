/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { DocumentNumberSettings } from '../DocumentNumberSettings'
import { OrderEditingSettings } from '../OrderEditingSettings'

/**
 * Regression for #3293: non-CrudForm sales config writes must route through
 * `useGuardedMutation().runMutation(...)` so the global mutation injection
 * hooks (onBeforeSave/onAfterSave), scoped headers, retry, and unified 409
 * conflict surfacing run. `useGuardedMutation` is mocked to a pass-through so
 * the assertion is purely "the write went through the guarded runner" — before
 * the fix these components called `apiCall` directly and `runMutation` was
 * never invoked.
 */

const apiCallMock = jest.fn()
const runMutationMock = jest.fn(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
const retryLastMutationMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  withScopedApiRequestHeaders: (_headers: unknown, fn: () => unknown) => fn(),
  readApiResultOrThrow: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: (...args: unknown[]) => runMutationMock(...(args as [{ operation: () => Promise<unknown> }])),
    retryLastMutation: retryLastMutationMock,
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))

describe('sales config writes route through useGuardedMutation (#3293)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    runMutationMock.mockImplementation(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
    apiCallMock.mockImplementation(async (_path: string, init?: { method?: string }) => {
      if (!init || !init.method) {
        return {
          ok: true,
          result: {
            orderNumberFormat: 'ORD-{seq}',
            quoteNumberFormat: 'QUO-{seq}',
            nextOrderNumber: 1,
            nextQuoteNumber: 1,
            tokens: [],
            orderStatuses: [],
            orderCustomerEditableStatuses: null,
            orderAddressEditableStatuses: null,
          },
        }
      }
      return { ok: true, result: {} }
    })
  })

  it('DocumentNumberSettings: saving routes the PUT through runMutation', async () => {
    renderWithProviders(<DocumentNumberSettings />)
    await waitFor(() => expect(apiCallMock).toHaveBeenCalledWith('/api/sales/settings/document-numbers'))

    const saveButton = await screen.findByRole('button', { name: /save settings/i })
    await waitFor(() => expect(saveButton).toBeEnabled())
    fireEvent.click(saveButton)

    await waitFor(() => expect(runMutationMock).toHaveBeenCalledTimes(1))
    expect(runMutationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          resourceKind: 'sales.settings',
          retryLastMutation: expect.any(Function),
        }),
        mutationPayload: expect.objectContaining({ orderNumberFormat: expect.any(String) }),
      }),
    )
    expect(apiCallMock).toHaveBeenCalledWith(
      '/api/sales/settings/document-numbers',
      expect.objectContaining({ method: 'PUT' }),
    )
  })

  it('OrderEditingSettings: saving routes the PUT through runMutation', async () => {
    renderWithProviders(<OrderEditingSettings />)
    await waitFor(() => expect(apiCallMock).toHaveBeenCalledWith('/api/sales/settings/order-editing'))

    const saveButton = await screen.findByRole('button', { name: /save settings/i })
    await waitFor(() => expect(saveButton).toBeEnabled())
    fireEvent.click(saveButton)

    await waitFor(() => expect(runMutationMock).toHaveBeenCalledTimes(1))
    expect(runMutationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          resourceKind: 'sales.settings',
          retryLastMutation: expect.any(Function),
        }),
      }),
    )
    expect(apiCallMock).toHaveBeenCalledWith(
      '/api/sales/settings/order-editing',
      expect.objectContaining({ method: 'PUT' }),
    )
  })
})
