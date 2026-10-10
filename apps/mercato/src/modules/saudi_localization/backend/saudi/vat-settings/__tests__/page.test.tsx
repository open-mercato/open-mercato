/**
 * @jest-environment jsdom
 *
 * The screen is small but it guards a compliance input, so three behaviours are
 * worth a rendered test rather than a helper test: the settings come back from
 * the API into the form, the incomplete banner is shown until the seller identity
 * is valid, and the VAT rate is converted from the percent an operator types
 * (including a comma decimal separator) to the fraction the API stores.
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import SaudiVatSettingsPage from '../page'

const mockTranslate = (key: string, fallback?: string) => fallback ?? key

const apiCallMock = jest.fn()
const apiCallOrThrowMock = jest.fn()
const withScopedApiRequestHeadersMock = jest.fn(
  async (_headers: Record<string, string>, run: () => Promise<unknown>) => run(),
)

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
  withScopedApiRequestHeaders: (headers: Record<string, string>, run: () => Promise<unknown>) =>
    withScopedApiRequestHeadersMock(headers, run),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: (input: { operation: () => Promise<unknown> }) => input.operation(),
    retryLastMutation: jest.fn(),
  }),
}))

const flashMock = flash as jest.MockedFunction<typeof flash>

const storedSettings = {
  sellerName: 'Apex Trading Est.',
  vatRegistrationNumber: '300000000000003',
  commercialRegistrationNumber: '1010101010',
  vatRate: 0.15,
  invoiceQrEnabled: true,
  isComplete: true,
  canManage: true,
  updatedAt: '2026-01-31T09:15:00.000Z',
}

describe('SaudiVatSettingsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    withScopedApiRequestHeadersMock.mockImplementation(
      async (_headers: Record<string, string>, run: () => Promise<unknown>) => run(),
    )
    apiCallMock.mockResolvedValue({ ok: true, result: storedSettings } as never)
    apiCallOrThrowMock.mockResolvedValue({
      ok: true,
      result: { ...storedSettings, updatedAt: '2026-02-01T10:00:00.000Z' },
    } as never)
  })

  it('loads the stored settings into the form', async () => {
    render(<SaudiVatSettingsPage />)

    await waitFor(() => expect(screen.getByLabelText('Seller name')).toHaveValue('Apex Trading Est.'))
    expect(screen.getByLabelText('VAT registration number')).toHaveValue('300000000000003')
    expect(screen.getByLabelText('VAT rate (%)')).toHaveValue('15')
    expect(screen.queryByText('VAT settings are incomplete')).not.toBeInTheDocument()
  })

  it('warns while the seller identity is incomplete', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      result: { ...storedSettings, sellerName: '', vatRegistrationNumber: '', isComplete: false },
    } as never)

    render(<SaudiVatSettingsPage />)

    expect(await screen.findByText('VAT settings are incomplete')).toBeInTheDocument()
  })

  it('saves the rate as a fraction, accepting a comma decimal separator, and sends the version header', async () => {
    render(<SaudiVatSettingsPage />)
    await waitFor(() => expect(screen.getByLabelText('Seller name')).toHaveValue('Apex Trading Est.'))

    fireEvent.change(screen.getByLabelText('VAT rate (%)'), { target: { value: '15,5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(apiCallOrThrowMock).toHaveBeenCalledWith(
        '/api/saudi_localization/vat-settings',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"vatRate":0.155'),
        }),
      ),
    )
    // The expected version is what turns a stale tab into a conflict banner
    // instead of a silent overwrite.
    expect(withScopedApiRequestHeadersMock).toHaveBeenCalledWith(
      { 'x-om-ext-optimistic-lock-expected-updated-at': storedSettings.updatedAt },
      expect.any(Function),
    )
    expect(flashMock).toHaveBeenCalledWith('Saudi VAT settings saved.', 'success')
  })

  it('refuses an out-of-range rate without calling the API', async () => {
    render(<SaudiVatSettingsPage />)
    await waitFor(() => expect(screen.getByLabelText('Seller name')).toHaveValue('Apex Trading Est.'))
    apiCallOrThrowMock.mockClear()

    fireEvent.change(screen.getByLabelText('VAT rate (%)'), { target: { value: '150' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Enter a VAT rate between 0 and 100.')).toBeInTheDocument()
    expect(apiCallOrThrowMock).not.toHaveBeenCalled()
  })

  it('reports a rejected save without leaking the failure', async () => {
    apiCallOrThrowMock.mockRejectedValue(new Error('[internal] conflict'))

    render(<SaudiVatSettingsPage />)
    await waitFor(() => expect(screen.getByLabelText('Seller name')).toHaveValue('Apex Trading Est.'))

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(flashMock).toHaveBeenCalledWith('Unable to save the Saudi VAT settings.', 'error'),
    )
  })

  it('surfaces a failed load with a retry action', async () => {
    apiCallMock.mockResolvedValue({ ok: false, result: null } as never)

    render(<SaudiVatSettingsPage />)

    expect(await screen.findByText('Unable to load the Saudi VAT settings.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  /**
   * The reported defect: the page opened on `settings.view`, so a caller without
   * `settings.manage` got an editable form whose Save the guard answered with a
   * 403 — the operator filled it in, saw "Unable to save", and found the values
   * gone on reload. Read access is what `view` grants, so the values stay on
   * screen, but nothing offers a write that cannot land.
   */
  it('shows view-only callers the settings without offering a doomed save', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      result: { ...storedSettings, canManage: false },
    } as never)

    render(<SaudiVatSettingsPage />)

    await waitFor(() => expect(screen.getByLabelText('Seller name')).toHaveValue('Apex Trading Est.'))
    expect(screen.getByLabelText('Seller name')).toBeDisabled()
    expect(screen.getByLabelText('VAT registration number')).toBeDisabled()
    expect(screen.getByLabelText('VAT rate (%)')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(screen.getByText('Read-only view')).toBeInTheDocument()
    expect(apiCallOrThrowMock).not.toHaveBeenCalled()
  })

  it('reports a revoked grant as a permission failure and stops offering the write', async () => {
    apiCallOrThrowMock.mockRejectedValue({ status: 403, message: 'Forbidden' })

    render(<SaudiVatSettingsPage />)
    await waitFor(() => expect(screen.getByLabelText('Seller name')).toHaveValue('Apex Trading Est.'))

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(flashMock).toHaveBeenCalledWith(
        'You do not have permission to change the Saudi VAT settings.',
        'error',
      ),
    )
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })
})
