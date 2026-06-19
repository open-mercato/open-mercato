/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import CurrencyFetchingConfig from '../CurrencyFetchingConfig'

const apiCallMock = jest.fn()
const flashMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  withScopedApiRequestHeaders: (_headers: unknown, run: () => unknown) => run(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: () => ({}),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))

// Any of these substrings appearing on a rendered element means the screen is
// still leaning on hardcoded Tailwind status palettes instead of DS status tokens.
const HARDCODED_STATUS_COLOR_SELECTOR = [
  '[class*="bg-green-"]',
  '[class*="text-green-"]',
  '[class*="bg-red-"]',
  '[class*="text-red-"]',
  '[class*="border-red-"]',
  '[class*="bg-yellow-"]',
  '[class*="text-yellow-"]',
].join(',')

const enabledErrorConfig = {
  id: 'cfg-1',
  provider: 'NBP',
  isEnabled: true,
  syncTime: '09:00',
  lastSyncAt: null,
  lastSyncStatus: 'error',
  lastSyncMessage: 'Provider unavailable',
  lastSyncCount: 5,
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('CurrencyFetchingConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders an enabled provider with DS primitives instead of raw controls and hardcoded status colors', async () => {
    apiCallMock.mockResolvedValue({ result: { configs: [enabledErrorConfig] } })

    const { container } = renderWithProviders(<CurrencyFetchingConfig />)

    await waitFor(() =>
      expect(screen.getByText('currencies.fetch.fetch_now')).toBeInTheDocument(),
    )

    // No hardcoded Tailwind status palettes — the status badge and error notice
    // must use DS status tokens (issue #3192 :195-204 and :321-323).
    expect(container.querySelectorAll(HARDCODED_STATUS_COLOR_SELECTOR)).toHaveLength(0)

    // The raw <input type="time"> is replaced by the shared TimeInput primitive (:279-284).
    expect(container.querySelector('input[type="time"]')).toBeNull()

    // A missing last-sync date is localized, never the hardcoded English "Never" (:187-190).
    expect(screen.queryByText('Never')).toBeNull()
    expect(screen.getByText('currencies.fetch.last_sync_never')).toBeInTheDocument()

    // Non-submit action button carries an explicit type=button (:297-311).
    expect(
      screen.getByRole('button', { name: 'currencies.fetch.fetch_now' }),
    ).toHaveAttribute('type', 'button')

    // The error message renders through the DS Alert primitive (role="alert"), not a raw red <div>.
    expect(screen.getByRole('alert')).toHaveTextContent('Provider unavailable')
  })

  it('flashes a localized success message without hardcoded copy after fetching rates', async () => {
    apiCallMock.mockImplementation((url: string) => {
      if (url === '/api/currencies/fetch-rates') {
        return Promise.resolve({ result: { byProvider: { NBP: { count: 3 } } } })
      }
      return Promise.resolve({ result: { configs: [enabledErrorConfig] } })
    })

    renderWithProviders(<CurrencyFetchingConfig />)

    const fetchButton = await screen.findByRole('button', {
      name: 'currencies.fetch.fetch_now',
    })
    fireEvent.click(fetchButton)

    await waitFor(() => expect(flashMock).toHaveBeenCalled())
    const successCall = flashMock.mock.calls.find(([, level]) => level === 'success')
    expect(successCall).toBeTruthy()
    // The success copy is fully sourced from i18n — no hardcoded "rates fetched" suffix (:172).
    expect(String(successCall?.[0])).not.toMatch(/rates fetched/i)
  })

  it('marks the Initialize Providers button as type=button in the empty state', async () => {
    apiCallMock.mockResolvedValue({ result: {} })

    renderWithProviders(<CurrencyFetchingConfig />)

    const initButton = await screen.findByRole('button', {
      name: 'currencies.fetch.initialize_providers',
    })
    // Non-submit action button carries an explicit type=button (:335-339).
    expect(initButton).toHaveAttribute('type', 'button')
  })
})
