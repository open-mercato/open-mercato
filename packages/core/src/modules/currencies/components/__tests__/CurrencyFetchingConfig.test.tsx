/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import CurrencyFetchingConfig from '../CurrencyFetchingConfig'

const apiCallMock = jest.fn()
const flashMock = jest.fn()
const runMutationMock = jest.fn(({ operation }: { operation: () => unknown }) => operation())
const retryLastMutationMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  withScopedApiRequestHeaders: (_headers: unknown, run: () => unknown) => run(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: () => ({}),
  extractOptimisticLockConflict: () => null,
}))

// Guarded mutations (#3191) are mocked with a pass-through spy so routing can be
// asserted while the component keeps rendering real DS primitives (#3192).
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: runMutationMock, retryLastMutation: retryLastMutationMock }),
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

describe('CurrencyFetchingConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    runMutationMock.mockImplementation(({ operation }: { operation: () => unknown }) => operation())
  })

  describe('design-system + i18n cleanup (#3192)', () => {
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

  describe('guarded mutations (#3191)', () => {
    it('routes toggle, sync-time, and fetch-now through the guarded mutation', async () => {
      apiCallMock.mockResolvedValue({
        ok: true,
        status: 200,
        result: { configs: [enabledNbp, disabledRaiffeisen] },
      })

      const { container } = renderWithProviders(<CurrencyFetchingConfig />)
      await waitFor(() => expect(screen.getAllByRole('switch').length).toBeGreaterThan(0))

      // toggle (PUT)
      fireEvent.click(screen.getAllByRole('switch')[0])
      await waitFor(() => expect(runMutationMock).toHaveBeenCalled())
      expect(runMutationMock.mock.calls.at(-1)?.[0]?.context?.resourceKind).toBe('currencies.fetch_config')

      // sync-time (PUT) — the DS TimeInput renders hour/minute number inputs, not a raw input[type=time].
      runMutationMock.mockClear()
      const hourInput = container.querySelectorAll('input[type="number"]')[0] as HTMLInputElement
      expect(hourInput).toBeTruthy()
      fireEvent.change(hourInput, { target: { value: '10' } })
      await waitFor(() => expect(runMutationMock).toHaveBeenCalled())
      expect(runMutationMock.mock.calls.at(-1)?.[0]?.context?.resourceKind).toBe('currencies.fetch_config')

      // fetch-now (POST)
      runMutationMock.mockClear()
      fireEvent.click(screen.getByRole('button', { name: 'currencies.fetch.fetch_now' }))
      await waitFor(() => expect(runMutationMock).toHaveBeenCalled())
      expect(runMutationMock.mock.calls.at(-1)?.[0]?.context?.resourceKind).toBe('currencies.fetch_rates')
    })

    it('routes auto-initialized provider creation through the guarded mutation', async () => {
      apiCallMock.mockResolvedValue({
        ok: true,
        status: 200,
        result: { configs: [] },
      })

      renderWithProviders(<CurrencyFetchingConfig />)

      await waitFor(() => expect(runMutationMock).toHaveBeenCalled())
      expect(runMutationMock.mock.calls.at(-1)?.[0]?.context?.resourceKind).toBe('currencies.fetch_config')
    })
  })
})
