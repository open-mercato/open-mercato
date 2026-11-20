/** @jest-environment jsdom */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { formatPayPageAmount } from '../../lib/payPageAmount'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
  useLocale: () => 'en-US',
  useSupportedLocales: () => ['en-US'],
}))

jest.mock('@open-mercato/ui/backend/markdown/MarkdownContent', () => ({ MarkdownContent: () => null }))

import { PayPagePricing, PayPageSummary, type PayPagePricingProps, type PayLinkPayload } from '../PayPage'

const themeTokens = {
  mode: 'light',
  accent: '#000000',
  accentSecondary: '#000000',
  accentContrast: '#ffffff',
  text: '#000000',
  mutedText: '#000000',
  pageBackground: '#ffffff',
  shellBackground: '#ffffff',
  surface: '#ffffff',
  surfaceMuted: '#ffffff',
  surfaceStrong: '#ffffff',
  border: '#000000',
  borderStrong: '#000000',
  shadow: 'none',
  accentShadow: 'none',
  heroBackground: '#ffffff',
  errorText: '#000000',
  errorBorder: '#000000',
  errorSurface: '#ffffff',
  errorSurfaceStrong: '#ffffff',
  errorRing: '#000000',
} satisfies PayPagePricingProps['themeTokens']

const formatAmount: PayPagePricingProps['formatAmount'] = (value, code, exact) => formatPayPageAmount(value, code, 'en-US', exact)

function renderPricing(payload: PayLinkPayload, amountExact?: string) {
  return render(<PayPagePricing
    payload={payload}
    amount={amountExact ? Number(amountExact) : null}
    amountExact={amountExact}
    selectedPriceItemId={null}
    fieldErrors={{}}
    inputsLocked={false}
    formatAmount={formatAmount}
    onAmountChange={() => {}}
    onPriceItemSelect={() => {}}
    translateValidationMessage={(message) => message ?? ''}
    themeTokens={themeTokens}
  />)
}

describe('pay page exact amount display', () => {
  it('renders the exact fixed price and original price', () => {
    renderPricing({
      id: 'eth-link',
      name: 'ETH payment',
      slug: 'eth',
      pricingMode: 'fixed',
      fixedPriceCurrencyCode: 'ETH',
      fixedPriceAmount: 1.1234567890123457,
      fixedPriceAmountExact: '1.123456789012345678',
      fixedPriceOriginalAmount: 2.9876543210987654,
      fixedPriceOriginalAmountExact: '2.987654321098765432',
    })

    expect(screen.getByText('ETH 1.123456789012345678')).toBeTruthy()
    expect(screen.getByText('ETH 2.987654321098765432')).toBeTruthy()
  })

  it('renders the exact custom amount bounds', () => {
    renderPricing({
      id: 'eth-link',
      name: 'ETH payment',
      slug: 'eth',
      pricingMode: 'custom_amount',
      customAmountCurrencyCode: 'ETH',
      customAmountMin: 1e-18,
      customAmountMinExact: '0.000000000000000001',
      customAmountMax: 10,
      customAmountMaxExact: '9.999999999999999999',
    }, '1.000000000000000001')

    expect(screen.getByPlaceholderText('ETH 0.000000000000000001 - ETH 9.999999999999999999')).toBeTruthy()
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('1.000000000000000001')
  })

  it('renders an exact price-list item and selected summary', () => {
    const payload: PayLinkPayload = {
      id: 'eth-link',
      name: 'ETH payment',
      slug: 'eth',
      pricingMode: 'price_list',
      priceListItems: [{ id: 'wei', description: 'One wei', currencyCode: 'ETH', amount: 1e-18, amountExact: '0.000000000000000001' }],
    }
    renderPricing(payload)
    expect(screen.getByText('ETH 0.000000000000000001')).toBeTruthy()
    render(<PayPageSummary
      payload={payload}
      selectedAmount={1e-18}
      selectedAmountExact="0.000000000000000001"
      currencyCode="ETH"
      formatAmount={formatAmount}
      preview={false}
      themeTokens={themeTokens}
    />)
    expect(screen.getAllByText('ETH 0.000000000000000001')).toHaveLength(2)
  })
})
