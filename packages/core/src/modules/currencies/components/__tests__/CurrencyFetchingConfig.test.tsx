/**
 * @jest-environment jsdom
 */
import type React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import CurrencyFetchingConfig from '../CurrencyFetchingConfig'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

const mockTranslate = (key: string, fallback?: string) => fallback ?? key
const mockRunMutation = jest.fn(({ operation }: { operation: () => unknown }) => operation())
const mockRetryLastMutation = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: mockRunMutation, retryLastMutation: mockRetryLastMutation }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  withScopedApiRequestHeaders: (_headers: unknown, run: () => unknown) => run(),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button data-testid="fetch-button" onClick={onClick} disabled={disabled}>{children}</button>
  ),
}))

jest.mock('@open-mercato/ui/primitives/spinner', () => ({
  Spinner: () => null,
}))

jest.mock('@open-mercato/ui/primitives/switch', () => ({
  Switch: ({ onCheckedChange }: any) => (
    <button data-testid="switch" onClick={() => onCheckedChange?.()}>switch</button>
  ),
}))

const enabledNbp = {
  id: 'cfg-nbp',
  provider: 'NBP',
  isEnabled: true,
  syncTime: '09:00',
  lastSyncAt: null,
  lastSyncStatus: null,
  lastSyncMessage: null,
  lastSyncCount: null,
  updatedAt: '2024-01-01',
}
const disabledRaiffeisen = {
  id: 'cfg-raif',
  provider: 'Raiffeisen Bank Polska',
  isEnabled: false,
  syncTime: '09:00',
  lastSyncAt: null,
  lastSyncStatus: null,
  lastSyncMessage: null,
  lastSyncCount: null,
  updatedAt: '2024-01-01',
}

describe('CurrencyFetchingConfig — guarded mutations (#3191)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('routes toggle, sync-time, and fetch-now through the guarded mutation', async () => {
    ;(apiCall as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      result: { configs: [enabledNbp, disabledRaiffeisen] },
    })

    const { container } = render(<CurrencyFetchingConfig />)
    await waitFor(() => expect(screen.getAllByTestId('switch').length).toBeGreaterThan(0))

    // toggle (PUT)
    fireEvent.click(screen.getAllByTestId('switch')[0])
    await waitFor(() => expect(mockRunMutation).toHaveBeenCalled())
    expect(mockRunMutation.mock.calls.at(-1)?.[0]?.context?.resourceKind).toBe('currencies.fetch_config')

    // sync-time (PUT)
    mockRunMutation.mockClear()
    const timeInput = container.querySelector('input[type="time"]') as HTMLInputElement
    expect(timeInput).toBeTruthy()
    fireEvent.change(timeInput, { target: { value: '10:30' } })
    await waitFor(() => expect(mockRunMutation).toHaveBeenCalled())
    expect(mockRunMutation.mock.calls.at(-1)?.[0]?.context?.resourceKind).toBe('currencies.fetch_config')

    // fetch-now (POST)
    mockRunMutation.mockClear()
    fireEvent.click(screen.getByTestId('fetch-button'))
    await waitFor(() => expect(mockRunMutation).toHaveBeenCalled())
    expect(mockRunMutation.mock.calls.at(-1)?.[0]?.context?.resourceKind).toBe('currencies.fetch_rates')
  })

  it('routes auto-initialized provider creation through the guarded mutation', async () => {
    ;(apiCall as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      result: { configs: [] },
    })

    render(<CurrencyFetchingConfig />)

    await waitFor(() => expect(mockRunMutation).toHaveBeenCalled())
    expect(mockRunMutation.mock.calls.at(-1)?.[0]?.context?.resourceKind).toBe('currencies.fetch_config')
  })
})
