/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { OmnibusSettings } from '../OmnibusSettings'

if (typeof window !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => undefined
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
}

type ApiResult = { ok: boolean; status: number; result: unknown }

const mockApiCall = jest.fn<Promise<ApiResult>, [string, RequestInit?]>()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: [string, RequestInit?]) => mockApiCall(...args),
}))

const mockRetryLastMutation = jest.fn(async () => true)
const mockRunMutation = jest.fn(async (input: { operation: () => Promise<unknown> }) => input.operation())
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: (input: { operation: () => Promise<unknown> }) => mockRunMutation(input),
    retryLastMutation: mockRetryLastMutation,
  }),
}))

let mockGrantedFeatures: string[] = ['catalog.settings.view', 'catalog.settings.manage']
jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({
    payload: { grantedFeatures: mockGrantedFeatures },
    isReady: true,
    isLoading: false,
    refresh: async () => {},
  }),
}))

const mockFlash = jest.fn()
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => mockFlash(...args),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (key: string, fallback?: string, vars?: Record<string, unknown>) => {
    const base = (fallback ?? key) as string
    if (vars) return base.replace(/\{\{(\w+)\}\}/g, (_, token: string) => String(vars[token] ?? ''))
    return base
  }
  return { useT: () => translate }
})

const mockReportError = jest.fn()
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))

jest.mock('../prices/PriceScopeSelectors', () => ({
  PriceChannelSelect: ({ value, onChange, disabled }: { value: string; onChange: (next: string) => void; disabled?: boolean }) => (
    <input data-testid="channel-select" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
  ),
  PricePriceKindSelect: ({ value, onChange, disabled }: { value: string; onChange: (next: string) => void; disabled?: boolean }) => (
    <input data-testid="price-kind-select" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
  ),
}))

const CHANNEL_ID = '11111111-1111-4111-8111-111111111111'
const PRICE_KIND_ID = '22222222-2222-4222-8222-222222222222'

const STORED_CONFIG = {
  enabled: false,
  enabledCountryCodes: ['PL'],
  noChannelMode: 'best_effort',
  lookbackDays: 30,
  minimizationAxis: 'gross',
  defaultPresentedPriceKindId: PRICE_KIND_ID,
  backfillCoverage: {},
  channels: {
    [CHANNEL_ID]: { presentedPriceKindId: PRICE_KIND_ID, countryCode: 'PL' },
  },
}

function mockLoad(config: unknown = STORED_CONFIG) {
  mockApiCall.mockResolvedValue({ ok: true, status: 200, result: config })
}

function patchCalls() {
  return mockApiCall.mock.calls.filter(([, init]) => init?.method === 'PATCH')
}

async function renderLoaded() {
  render(<OmnibusSettings />)
  await screen.findByTestId('catalog-omnibus-lookback')
}

describe('OmnibusSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGrantedFeatures = ['catalog.settings.view', 'catalog.settings.manage']
  })

  it('loads the config and saves the patch through the guarded mutation', async () => {
    mockLoad()
    await renderLoaded()
    expect(mockApiCall).toHaveBeenCalledWith('/api/catalog/config/omnibus')

    fireEvent.change(screen.getByTestId('catalog-omnibus-lookback'), { target: { value: '45' } })
    fireEvent.click(screen.getByTestId('catalog-omnibus-save'))

    await waitFor(() => expect(mockFlash).toHaveBeenCalledWith('Omnibus settings saved.', 'success'))
    expect(mockRunMutation).toHaveBeenCalledTimes(1)
    const mutation = mockRunMutation.mock.calls[0][0] as unknown as {
      context: Record<string, unknown>
      mutationPayload: Record<string, unknown>
    }
    expect(mutation.context.retryLastMutation).toBe(mockRetryLastMutation)
    expect(mutation.context.resourceKind).toBe('catalog.settings')
    expect(mutation.mutationPayload).toEqual({
      enabled: false,
      lookbackDays: 45,
      enabledCountryCodes: ['PL'],
      noChannelMode: 'best_effort',
      minimizationAxis: 'gross',
      defaultPresentedPriceKindId: PRICE_KIND_ID,
      channels: { [CHANNEL_ID]: { presentedPriceKindId: PRICE_KIND_ID, countryCode: 'PL' } },
    })
    const [[url, init]] = patchCalls()
    expect(url).toBe('/api/catalog/config/omnibus')
    expect(JSON.parse(String(init?.body))).toEqual(mutation.mutationPayload)
  })

  it('submits with Cmd/Ctrl+Enter and resets unsaved changes on Escape', async () => {
    mockLoad()
    await renderLoaded()
    const lookback = screen.getByTestId('catalog-omnibus-lookback')

    fireEvent.change(lookback, { target: { value: '60' } })
    fireEvent.keyDown(lookback, { key: 'Escape' })
    expect((screen.getByTestId('catalog-omnibus-lookback') as HTMLInputElement).value).toBe('30')

    fireEvent.keyDown(lookback, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(patchCalls()).toHaveLength(1))
  })

  it('blocks submission with a client-side field error for an out-of-range lookback', async () => {
    mockLoad()
    await renderLoaded()
    fireEvent.change(screen.getByTestId('catalog-omnibus-lookback'), { target: { value: '0' } })
    fireEvent.click(screen.getByTestId('catalog-omnibus-save'))

    expect(await screen.findByText('Enter a whole number of days between 1 and 365.')).toBeInTheDocument()
    expect(mockRunMutation).not.toHaveBeenCalled()
    expect(patchCalls()).toHaveLength(0)
  })

  it('maps 400 field errors from the server onto the form fields', async () => {
    mockApiCall.mockImplementation(async (_url, init) => {
      if (init?.method === 'PATCH') {
        return {
          ok: false,
          status: 400,
          result: {
            error: 'Invalid config',
            details: {
              fieldErrors: {
                'enabledCountryCodes.0': ['omnibus_country_code_unknown'],
                [`channels.${CHANNEL_ID}.countryCode`]: ['omnibus_country_code_eu_not_allowed'],
              },
            },
          },
        }
      }
      return { ok: true, status: 200, result: STORED_CONFIG }
    })
    await renderLoaded()
    fireEvent.click(screen.getByTestId('catalog-omnibus-save'))

    expect(await screen.findByText('Unknown country code.')).toBeInTheDocument()
    expect(screen.getByText('List individual member states instead of "EU".')).toBeInTheDocument()
    expect(screen.getByText('Fix the highlighted fields and try again.')).toBeInTheDocument()
    expect(mockFlash).not.toHaveBeenCalled()
  })

  it('surfaces the 422 backfill gate as an alert', async () => {
    mockApiCall.mockImplementation(async (_url, init) => {
      if (init?.method === 'PATCH') {
        return {
          ok: false,
          status: 422,
          result: { field: 'enabled', error: 'backfill_required_before_enable', channels: [CHANNEL_ID] },
        }
      }
      if (_url.startsWith('/api/sales/channels')) {
        return { ok: true, status: 200, result: { items: [{ id: CHANNEL_ID, name: 'Online EU' }] } }
      }
      return { ok: true, status: 200, result: STORED_CONFIG }
    })
    await renderLoaded()
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByTestId('catalog-omnibus-save'))

    const alert = await screen.findByTestId('catalog-omnibus-backfill-required')
    expect(alert).toHaveTextContent('Backfill required before enabling')
    expect(alert).toHaveTextContent('omnibus:backfill')
    await waitFor(() => expect(alert).toHaveTextContent(`Online EU (${CHANNEL_ID})`))
    expect(mockApiCall.mock.calls.some(([url]) => url === `/api/sales/channels?ids=${CHANNEL_ID}&pageSize=1`)).toBe(true)
    const [[, init]] = patchCalls()
    expect(JSON.parse(String(init?.body)).enabled).toBe(true)
  })

  it('warns when the lookback increased since the last backfill', async () => {
    mockLoad({
      ...STORED_CONFIG,
      backfillCoverage: { [CHANNEL_ID]: { completedAt: '2026-06-01T00:00:00.000Z', lookbackDays: 30 } },
    })
    await renderLoaded()
    expect(screen.queryByTestId('catalog-omnibus-backfill-stale')).not.toBeInTheDocument()

    fireEvent.change(screen.getByTestId('catalog-omnibus-lookback'), { target: { value: '60' } })
    expect(screen.getByTestId('catalog-omnibus-backfill-stale')).toHaveTextContent(CHANNEL_ID)
  })

  it('names the channels in the stale-backfill warning', async () => {
    const config = {
      ...STORED_CONFIG,
      backfillCoverage: { [CHANNEL_ID]: { completedAt: '2026-06-01T00:00:00.000Z', lookbackDays: 30 } },
    }
    mockApiCall.mockImplementation(async (url) => {
      if (url.startsWith('/api/sales/channels')) {
        return { ok: true, status: 200, result: { items: [{ id: CHANNEL_ID, name: 'Online EU' }] } }
      }
      return { ok: true, status: 200, result: config }
    })
    await renderLoaded()
    fireEvent.change(screen.getByTestId('catalog-omnibus-lookback'), { target: { value: '60' } })

    await waitFor(() => expect(screen.getByTestId('catalog-omnibus-backfill-stale')).toHaveTextContent(`Online EU (${CHANNEL_ID})`))
    fireEvent.change(screen.getByTestId('catalog-omnibus-lookback'), { target: { value: '61' } })
    const lookups = mockApiCall.mock.calls.filter(([url]) => url.startsWith('/api/sales/channels'))
    expect(lookups).toHaveLength(1)
  })

  it('renders read-only without catalog.settings.manage', async () => {
    mockGrantedFeatures = ['catalog.settings.view']
    mockLoad()
    await renderLoaded()

    expect(screen.getByText('You can view these settings but not change them.')).toBeInTheDocument()
    expect(screen.queryByTestId('catalog-omnibus-save')).not.toBeInTheDocument()
    expect(screen.queryByText('Add channel')).not.toBeInTheDocument()
    expect(screen.getByRole('switch')).toBeDisabled()
    expect(screen.getByTestId('catalog-omnibus-lookback')).toBeDisabled()
    expect(screen.getByTestId('channel-select')).toBeDisabled()

    fireEvent.keyDown(screen.getByTestId('catalog-omnibus-lookback'), { key: 'Enter', ctrlKey: true })
    expect(mockRunMutation).not.toHaveBeenCalled()
  })

  it('renders nothing and skips loading without catalog.settings.view', () => {
    mockGrantedFeatures = ['catalog.products.view']
    mockLoad()
    const { container } = render(<OmnibusSettings />)
    expect(container).toBeEmptyDOMElement()
    expect(mockApiCall).not.toHaveBeenCalled()
  })

  it('shows an error state when loading fails', async () => {
    mockApiCall.mockResolvedValue({ ok: false, status: 500, result: { error: 'Internal server error' } })
    render(<OmnibusSettings />)
    expect(await screen.findByText('Failed to load Omnibus settings.')).toBeInTheDocument()
  })

  it('reports an unexpected load failure', async () => {
    const failure = new Error('network down')
    mockApiCall.mockRejectedValue(failure)
    render(<OmnibusSettings />)
    expect(await screen.findByText('Failed to load Omnibus settings.')).toBeInTheDocument()
    expect(mockReportError).toHaveBeenCalledWith(failure, { module: 'catalog', code: 'catalog.omnibus_settings_load_failed' })
  })
})
