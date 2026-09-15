/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { PriceWithCurrency, formatPriceWithCurrency } from '../PriceWithCurrency'

// `Intl` separates an amount from its currency code with a non-breaking (or narrow non-breaking)
// space, which is not the ASCII space a literal comparison assumes.
const normalize = (value: string) => value.replace(/[  ]/g, ' ')

// `PriceWithCurrency` is deep-importable and had no i18n dependency before it started formatting in
// the application locale. Reading the locale through `useLocale()` would have made it throw outside
// `I18nProvider`, narrowing the mounting contract of an exported component (#5182 review, minor 5).
// These cases lock both halves of the contract: it still mounts bare, and it still follows the app
// locale when a provider is in scope.
describe('PriceWithCurrency — provider is optional', () => {
  it('renders outside I18nProvider without throwing, on the runtime default locale', () => {
    expect(() => render(<PriceWithCurrency amount={15} currency="EUR" />)).not.toThrow()
    // Compared against the helper called with no locale rather than against a literal, so the
    // assertion holds on every runner regardless of its default locale.
    const rendered = screen.getByText(/15/)
    expect(normalize(rendered.textContent ?? '')).toBe(normalize(formatPriceWithCurrency(15, 'EUR')))
  })

  it('follows the application locale when a provider is in scope', () => {
    render(
      <I18nProvider locale="pl" dict={{}}>
        <PriceWithCurrency amount={1234.5} currency="USD" />
      </I18nProvider>,
    )
    expect(normalize(screen.getByText(/1234/).textContent ?? '')).toBe('1234,50 USD')
  })
})
