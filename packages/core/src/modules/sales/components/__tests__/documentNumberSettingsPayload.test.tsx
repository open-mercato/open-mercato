/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import {
  buildDocumentNumberSettingsPayload,
  DocumentNumberSettings,
  type DocumentNumberSettingsFormState,
} from '../DocumentNumberSettings'

const apiCallMock = jest.fn()
const apiCallOrThrowMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
  withScopedApiRequestHeaders: (_headers: unknown, fn: () => unknown) => fn(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))

const loaded: DocumentNumberSettingsFormState = {
  orderNumberFormat: 'ORDER-{seq:5}',
  quoteNumberFormat: 'QUOTE-{seq:5}',
  orderNextNumber: '100',
  quoteNextNumber: '40',
}

const settingsResult = {
  orderNumberFormat: 'ORDER-{seq:5}',
  quoteNumberFormat: 'QUOTE-{seq:5}',
  nextOrderNumber: 100,
  nextQuoteNumber: 40,
  tokens: [],
}

function sentBody(): Record<string, unknown> {
  const init = apiCallOrThrowMock.mock.calls[0]?.[1] as { body?: string } | undefined
  return JSON.parse(init?.body ?? '{}') as Record<string, unknown>
}

describe('document number settings only send counters the user changed (#6367)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    apiCallMock.mockResolvedValue({ ok: true, result: settingsResult })
    apiCallOrThrowMock.mockResolvedValue({ ok: true, result: settingsResult })
  })

  it('omits counters that still match the loaded values', () => {
    const payload = buildDocumentNumberSettingsPayload({ ...loaded, orderNumberFormat: ' SO-{seq:6} ' }, loaded)

    expect(payload).toEqual({
      orderNumberFormat: 'SO-{seq:6}',
      quoteNumberFormat: 'QUOTE-{seq:5}',
      orderNextNumber: undefined,
      quoteNextNumber: undefined,
    })
  })

  it('sends only the counter the user edited', () => {
    const payload = buildDocumentNumberSettingsPayload({ ...loaded, orderNextNumber: '7' }, loaded)

    expect(payload.orderNextNumber).toBe(7)
    expect(payload.quoteNextNumber).toBeUndefined()
  })

  it('does not echo stale counters when only a format is saved from the page', async () => {
    renderWithProviders(<DocumentNumberSettings />)
    const saveButton = await screen.findByRole('button', { name: /save settings/i })
    await waitFor(() => expect(saveButton).toBeEnabled())
    await waitFor(() => expect(screen.getByDisplayValue('100')).toBeInTheDocument())

    fireEvent.change(screen.getByDisplayValue('ORDER-{seq:5}'), { target: { value: 'SO-{seq:6}' } })
    fireEvent.click(saveButton)

    await waitFor(() => expect(apiCallOrThrowMock).toHaveBeenCalledTimes(1))
    const body = sentBody()
    expect(body.orderNumberFormat).toBe('SO-{seq:6}')
    expect(body).not.toHaveProperty('orderNextNumber')
    expect(body).not.toHaveProperty('quoteNextNumber')
  })

  it('surfaces the server error message when the save is refused', async () => {
    apiCallOrThrowMock.mockRejectedValue(
      Object.assign(new Error('Document number cannot be edited.'), { status: 403 }),
    )
    renderWithProviders(<DocumentNumberSettings />)
    const saveButton = await screen.findByRole('button', { name: /save settings/i })
    await waitFor(() => expect(screen.getByDisplayValue('100')).toBeInTheDocument())

    fireEvent.change(screen.getByDisplayValue('100'), { target: { value: '7' } })
    fireEvent.click(saveButton)

    await waitFor(() => expect(flash).toHaveBeenCalledWith('Document number cannot be edited.', 'error'))
    expect(sentBody().orderNextNumber).toBe(7)
  })
})
