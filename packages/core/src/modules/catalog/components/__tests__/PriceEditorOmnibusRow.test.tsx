/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { PriceEditorOmnibusRow } from '../PriceEditorOmnibusRow'
import type { OmnibusBlock } from '../../lib/omnibusTypes'

type ApiResult = { ok: boolean; status: number; result: unknown }

const mockApiCall = jest.fn<Promise<ApiResult>, [string, RequestInit?]>()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: [string, RequestInit?]) => mockApiCall(...args),
}))

let mockLocale = 'en'
let mockGrantedFeatures: string[] = ['catalog.price_history.view']
jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({
    payload: { grantedFeatures: mockGrantedFeatures },
    isReady: true,
    isLoading: false,
    refresh: async () => {},
  }),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (key: string, fallback?: string, vars?: Record<string, unknown>) => {
    const base = (fallback ?? key) as string
    if (vars) return base.replace(/\{\{(\w+)\}\}/g, (_, token: string) => String(vars[token] ?? ''))
    return base
  }
  return { useT: () => translate, useLocale: () => mockLocale }
})

const mockReportError = jest.fn()
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))

const VARIANT_ID = '33333333-3333-4333-8333-333333333333'
const PRICE_KIND_ID = '22222222-2222-4222-8222-222222222222'

function buildBlock(overrides: Partial<OmnibusBlock> = {}): OmnibusBlock {
  return {
    presentedPriceKindId: PRICE_KIND_ID,
    lookbackDays: 30,
    minimizationAxis: 'gross',
    promotionAnchorAt: '2026-06-01T00:00:00.000Z',
    windowStart: '2026-05-02T00:00:00.000Z',
    windowEnd: '2026-06-01T00:00:00.000Z',
    coverageStartAt: null,
    lowestPriceNet: '81.3008',
    lowestPriceGross: '100.0000',
    previousPriceNet: '81.3008',
    previousPriceGross: '100.0000',
    currencyCode: 'PLN',
    applicable: true,
    applicabilityReason: 'announced_promotion',
    ...overrides,
  }
}

function renderRow(props: { channelSelectable?: boolean } = {}) {
  return render(<PriceEditorOmnibusRow variantId={VARIANT_ID} priceKindId={PRICE_KIND_ID} currencyCode="pln" {...props} />)
}

function money(amount: number, currency = 'PLN', locale = 'en'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount).replace(/\s+/g, ' ')
}

describe('PriceEditorOmnibusRow', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGrantedFeatures = ['catalog.price_history.view']
    mockLocale = 'en'
  })

  it('renders the reference price from omnibus-preview with the applicability reason', async () => {
    mockApiCall.mockResolvedValue({ ok: true, status: 200, result: buildBlock() })
    renderRow()

    expect(await screen.findByTestId('catalog-price-omnibus-reference')).toHaveTextContent(money(100))
    expect(screen.getByText('Lowest price in the last 30 days')).toBeInTheDocument()
    expect(screen.getByText('Announced promotion')).toBeInTheDocument()
    const [url] = mockApiCall.mock.calls[0]
    const params = new URL(url, 'http://localhost').searchParams
    expect(url.startsWith('/api/catalog/prices/omnibus-preview?')).toBe(true)
    expect(params.get('variantId')).toBe(VARIANT_ID)
    expect(params.get('priceKindId')).toBe(PRICE_KIND_ID)
    expect(params.get('currencyCode')).toBe('PLN')
  })

  it('uses the net amount when the minimization axis is net', async () => {
    mockApiCall.mockResolvedValue({ ok: true, status: 200, result: buildBlock({ minimizationAxis: 'net' }) })
    renderRow()
    expect(await screen.findByTestId('catalog-price-omnibus-reference')).toHaveTextContent(money(81.3008))
  })

  it('hides entirely when Omnibus is disabled (preview returns null)', async () => {
    mockApiCall.mockResolvedValue({ ok: true, status: 200, result: null })
    const { container } = renderRow()
    await waitFor(() => expect(container).toBeEmptyDOMElement())
    expect(mockApiCall).toHaveBeenCalledTimes(1)
  })

  it('hides without catalog.price_history.view and never calls the preview', () => {
    mockGrantedFeatures = ['catalog.products.view']
    const { container } = renderRow()
    expect(container).toBeEmptyDOMElement()
    expect(mockApiCall).not.toHaveBeenCalled()
  })

  it('renders the not-applicable state for a non-EU market', async () => {
    mockApiCall.mockResolvedValue({
      ok: true,
      status: 200,
      result: buildBlock({ applicable: false, applicabilityReason: 'not_in_eu_market', lowestPriceGross: null, lowestPriceNet: null }),
    })
    renderRow()
    expect(await screen.findByText('Omnibus reference price not applicable')).toBeInTheDocument()
    expect(screen.getByText('Not an EU market')).toBeInTheDocument()
    expect(screen.queryByTestId('catalog-price-omnibus-reference')).not.toBeInTheDocument()
  })

  it('shows the frozen reference and the price before a progressive reduction', async () => {
    mockApiCall.mockResolvedValue({
      ok: true,
      status: 200,
      result: buildBlock({ applicabilityReason: 'progressive_reduction_frozen', lowestPriceGross: '90.0000', previousPriceGross: '120.0000' }),
    })
    renderRow()
    expect(await screen.findByTestId('catalog-price-omnibus-reference')).toHaveTextContent(money(90))
    expect(screen.getByText('Reference price (frozen for the progressive reduction)')).toBeInTheDocument()
    expect(screen.getByText(`Price before the reduction: ${money(120)}`)).toBeInTheDocument()
  })

  it('warns when the history does not cover the full window', async () => {
    mockApiCall.mockResolvedValue({
      ok: true,
      status: 200,
      result: buildBlock({ applicabilityReason: 'insufficient_history', coverageStartAt: null }),
    })
    renderRow()
    expect(
      await screen.findByText('Price history does not cover the full window; the reference may be incomplete.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Insufficient history')).toBeInTheDocument()
  })

  it('formats amounts and dates with the active locale', async () => {
    mockLocale = 'de'
    mockApiCall.mockResolvedValue({
      ok: true,
      status: 200,
      result: buildBlock({ applicabilityReason: 'insufficient_history', coverageStartAt: '2026-05-10T12:00:00.000Z' }),
    })
    renderRow()
    expect(await screen.findByTestId('catalog-price-omnibus-reference')).toHaveTextContent(money(100, 'PLN', 'de'))
    const date = new Intl.DateTimeFormat('de', { dateStyle: 'medium' }).format(new Date('2026-05-10T12:00:00.000Z')).replace(/\s+/g, ' ')
    expect(
      screen.getByText(`Price history is only available since ${date}; the reference may be incomplete.`),
    ).toBeInTheDocument()
  })

  it('falls back to the raw currency code when it is not a valid ISO currency', async () => {
    mockApiCall.mockResolvedValue({ ok: true, status: 200, result: buildBlock({ currencyCode: 'POINTS' }) })
    renderRow()
    expect(await screen.findByTestId('catalog-price-omnibus-reference')).toHaveTextContent('POINTS 100.00')
  })

  it('asks for a channel when the host can select one', async () => {
    mockApiCall.mockResolvedValue({
      ok: true,
      status: 200,
      result: buildBlock({ applicable: false, applicabilityReason: 'missing_channel_context', lowestPriceGross: null, lowestPriceNet: null }),
    })
    renderRow()
    expect(await screen.findByText('Select a channel to compute the reference price.')).toBeInTheDocument()
  })

  it('explains per-channel computation when the host has no channel selector', async () => {
    mockApiCall.mockResolvedValue({
      ok: true,
      status: 200,
      result: buildBlock({ applicable: false, applicabilityReason: 'missing_channel_context', lowestPriceGross: null, lowestPriceNet: null }),
    })
    renderRow({ channelSelectable: false })
    expect(await screen.findByText('The reference price is computed per sales channel.')).toBeInTheDocument()
    expect(screen.queryByText('Select a channel to compute the reference price.')).not.toBeInTheDocument()
  })

  it('reports an unexpected preview failure', async () => {
    const failure = new Error('network down')
    mockApiCall.mockRejectedValue(failure)
    renderRow()
    expect(await screen.findByText('Could not load the Omnibus reference price.')).toBeInTheDocument()
    expect(mockReportError).toHaveBeenCalledWith(failure, { module: 'catalog', code: 'catalog.omnibus_preview_load_failed' })
  })
})
