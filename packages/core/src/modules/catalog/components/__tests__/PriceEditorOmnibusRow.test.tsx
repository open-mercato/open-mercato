/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'

const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
  useLocale: () => 'en',
}))

import { PriceEditorOmnibusRow } from '../PriceEditorOmnibusRow'

const block = {
  presentedPriceKindId: 'kind-1',
  lookbackDays: 30,
  minimizationAxis: 'gross' as const,
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
}

const resolveWith = (result: unknown, ok = true) => apiCallMock.mockResolvedValue({ ok, result, status: ok ? 200 : 400 })

describe('PriceEditorOmnibusRow', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
  })

  it('requests the preview for the scoped product and price kind', async () => {
    resolveWith(block)

    render(<PriceEditorOmnibusRow priceKindId="kind-1" currencyCode="PLN" productId="product-1" />)

    await waitFor(() => expect(apiCallMock).toHaveBeenCalled())
    const url = String(apiCallMock.mock.calls[0][0])
    expect(url).toContain('/api/catalog/prices/omnibus-preview?')
    const query = new URLSearchParams(url.split('?')[1])
    expect(query.get('priceKindId')).toBe('kind-1')
    expect(query.get('currencyCode')).toBe('PLN')
    expect(query.get('productId')).toBe('product-1')
    expect(query.get('variantId')).toBeNull()
  })

  it('forwards the variant, offer and channel scope when present', async () => {
    resolveWith(block)

    render(
      <PriceEditorOmnibusRow
        priceKindId="kind-1"
        currencyCode="PLN"
        productId="product-1"
        variantId="variant-1"
        offerId="offer-1"
        channelId="ch-pl"
      />,
    )

    await waitFor(() => expect(apiCallMock).toHaveBeenCalled())
    const query = new URLSearchParams(String(apiCallMock.mock.calls[0][0]).split('?')[1])
    expect(query.get('variantId')).toBe('variant-1')
    expect(query.get('offerId')).toBe('offer-1')
    expect(query.get('channelId')).toBe('ch-pl')
  })

  // The preview route requires at least one of product/variant/offer (rule M-6); firing the
  // request without one would just earn a 400.
  it('never calls the API without a resolvable scope', async () => {
    resolveWith(block)

    render(<PriceEditorOmnibusRow priceKindId="kind-1" currencyCode="PLN" />)

    await waitFor(() => expect(screen.queryByText(/Checking Omnibus/i)).not.toBeInTheDocument())
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('renders the lowest price for a standard announced promotion', async () => {
    resolveWith(block)

    render(<PriceEditorOmnibusRow priceKindId="kind-1" currencyCode="PLN" productId="product-1" />)

    expect(await screen.findByText(/100\.0000 PLN/)).toBeInTheDocument()
  })

  // Art. 6a(5): the frozen pre-campaign baseline is the reference, the deepest campaign step
  // is only the current price — swapping them would understate the reduction.
  it('separates the frozen baseline from the current step under a progressive reduction', async () => {
    resolveWith({
      ...block,
      applicabilityReason: 'progressive_reduction_frozen',
      lowestPriceGross: '100.0000',
      previousPriceGross: '70.0000',
    })

    render(<PriceEditorOmnibusRow priceKindId="kind-1" currencyCode="PLN" productId="product-1" />)

    expect(await screen.findByText(/Reference price \(before reduction\)/i)).toBeInTheDocument()
    expect(screen.getByText(/100\.0000 PLN/)).toBeInTheDocument()
    expect(screen.getByText(/Current \(progressive reduction/i)).toBeInTheDocument()
    expect(screen.getByText(/70\.0000 PLN/)).toBeInTheDocument()
  })

  it('explains a channel that is not configured for an EU market', async () => {
    resolveWith({ ...block, applicabilityReason: 'not_in_eu_market', lowestPriceGross: null })

    render(<PriceEditorOmnibusRow priceKindId="kind-1" currencyCode="PLN" productId="product-1" />)

    expect(await screen.findByText(/not configured for an EU market/i)).toBeInTheDocument()
  })

  it('warns when the channel context is missing', async () => {
    resolveWith({ ...block, applicabilityReason: 'missing_channel_context', lowestPriceGross: null })

    render(<PriceEditorOmnibusRow priceKindId="kind-1" currencyCode="PLN" productId="product-1" />)

    const warning = await screen.findByText(/Select a sales channel/i)
    // Warning state uses the semantic status token, never a raw Tailwind colour.
    expect(warning.className).toContain('text-status-warning-text')
  })

  it('reports an exempt perishable product', async () => {
    resolveWith({ ...block, applicabilityReason: 'perishable_exempt', lowestPriceGross: null })

    render(<PriceEditorOmnibusRow priceKindId="kind-1" currencyCode="PLN" productId="product-1" />)

    expect(await screen.findByText(/perishable goods rule/i)).toBeInTheDocument()
  })

  it('renders nothing when omnibus is disabled for the tenant', async () => {
    resolveWith(null)

    const { container } = render(
      <PriceEditorOmnibusRow priceKindId="kind-1" currencyCode="PLN" productId="product-1" />,
    )

    await waitFor(() => expect(apiCallMock).toHaveBeenCalled())
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('stays silent when the preview request fails', async () => {
    apiCallMock.mockRejectedValue(new Error('network down'))

    const { container } = render(
      <PriceEditorOmnibusRow priceKindId="kind-1" currencyCode="PLN" productId="product-1" />,
    )

    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('ignores a malformed payload rather than rendering a partial reference', async () => {
    resolveWith({ lowestPriceGross: '100.0000' })

    const { container } = render(
      <PriceEditorOmnibusRow priceKindId="kind-1" currencyCode="PLN" productId="product-1" />,
    )

    await waitFor(() => expect(apiCallMock).toHaveBeenCalled())
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})
