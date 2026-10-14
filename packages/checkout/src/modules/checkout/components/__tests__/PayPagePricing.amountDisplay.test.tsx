/**
 * @jest-environment jsdom
 */

jest.mock('lucide-react', () => {
  const IconStub = () => null
  return new Proxy(
    { __esModule: true },
    { get: (target, prop) => (prop in target ? (target as Record<string | symbol, unknown>)[prop] : IconStub) },
  )
})

jest.mock('next/navigation', () => ({
  useParams: () => ({}),
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
  useLocale: () => 'en-US',
  useSupportedLocales: () => ['en'],
}))

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  InjectionSpot: () => null,
  useInjectionSpotEvents: () => ({ triggerEvent: jest.fn() }),
  useInjectionWidgets: () => ({ widgets: [] }),
}))

jest.mock('@open-mercato/ui/backend/markdown/MarkdownContent', () => ({
  MarkdownContent: () => null,
}))

import * as React from 'react'
import { render } from '@testing-library/react'
import { PayPagePricing, type PayLinkPayload, type PayPageThemeTokens } from '../PayPage'
import { formatPayPageAmount } from '../../lib/payPageAmount'

const ETH_AMOUNT = '1.123456789012345678'
const ONE_WEI = '0.000000000000000001'

const themeTokens = new Proxy({} as PayPageThemeTokens, {
  get: (_target, prop) => (prop === 'mode' ? 'light' : '#000000'),
})

function renderPricing(payload: PayLinkPayload) {
  return render(
    <PayPagePricing
      payload={payload}
      amount={null}
      selectedPriceItemId={null}
      fieldErrors={{}}
      inputsLocked={false}
      formatAmount={(value, currencyCode) => formatPayPageAmount(value, currencyCode, 'en-US')}
      onAmountChange={() => undefined}
      onPriceItemSelect={() => undefined}
      translateValidationMessage={(message) => message ?? ''}
      themeTokens={themeTokens}
    />,
  )
}

function amountTexts(selector: string): Array<string | null> {
  return Array.from(document.querySelectorAll(selector)).map((node) => node.textContent)
}

describe('PayPagePricing amount display', () => {
  it('shows every charged digit of a fixed price', () => {
    renderPricing({
      id: 'link-1',
      name: 'Token sale',
      pricingMode: 'fixed',
      fixedPriceAmount: Number(ETH_AMOUNT),
      fixedPriceAmountExact: ETH_AMOUNT,
      fixedPriceCurrencyCode: 'ETH',
    })

    expect(amountTexts('.text-4xl')).toEqual([`ETH\u00a0${ETH_AMOUNT}`])
  })

  it('shows every charged digit of the price-list items', () => {
    renderPricing({
      id: 'link-2',
      name: 'Token tiers',
      pricingMode: 'price_list',
      priceListItems: [
        { id: 'tier-1', description: 'Tier one', amount: Number(ETH_AMOUNT), amountExact: ETH_AMOUNT, currencyCode: 'ETH' },
        { id: 'tier-2', description: 'One wei', amount: Number(ONE_WEI), amountExact: ONE_WEI, currencyCode: 'ETH' },
      ],
    })

    expect(amountTexts('label > span.whitespace-nowrap')).toEqual([
      `ETH\u00a0${ETH_AMOUNT}`,
      `ETH\u00a0${ONE_WEI}`,
    ])
  })
})
