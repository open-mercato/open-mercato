/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { StoreBrandingPreview, formatPreviewPrice } from '../StoreBrandingPreview'

let mockLocale = 'en'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
  useLocale: () => mockLocale,
}))

describe('formatPreviewPrice', () => {
  it('formats the sample price as currency in the active locale', () => {
    expect(formatPreviewPrice(29, 'eur', 'de')).toBe(new Intl.NumberFormat('de', { style: 'currency', currency: 'EUR' }).format(29))
  })

  it('falls back to the raw code when the currency is not a valid ISO code', () => {
    expect(formatPreviewPrice(29, 'POINTS', 'en')).toBe('29.00 POINTS')
  })
})

describe('StoreBrandingPreview', () => {
  it('renders the sample product price with the locale-aware formatter', () => {
    mockLocale = 'pl'
    render(<StoreBrandingPreview values={{}} storeName="Main store" currencyCode="PLN" />)
    const frame = screen.getByTestId('branding-preview-frame')
    const expected = new Intl.NumberFormat('pl', { style: 'currency', currency: 'PLN' }).format(29)
    expect(frame.getAttribute('srcdoc')).toContain(expected)
  })
})
