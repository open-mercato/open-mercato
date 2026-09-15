/**
 * @jest-environment jsdom
 *
 * UI-level regression test for issue #5828.
 *
 * The Units-of-measure fields used to re-parse and re-serialize the typed text on every
 * keystroke (`normalizeDecimalInput`), which dropped an in-progress decimal separator the
 * instant it was typed — `2,5` collapsed to `2` after the comma, so the next digit appended
 * onto "2" instead of "2." and the field ended at "125" instead of "12,5". The fix keeps the
 * raw text while editing and only converts to a canonical number at the submit boundary
 * (`toPositiveNumber` for live previews, `withCanonicalUomFields` before schema validation).
 *
 * The locale is pinned to `pl-PL` rather than left to the runner: CI resolves `C.UTF-8` to an
 * en-US ICU default, so an `en-US` pin passes on the buggy implementation too and a revert of
 * the locale-aware parse would stay green.
 */
import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { BASE_INITIAL_VALUES } from '../productForm'

jest.mock('lucide-react', () => {
  const IconStub = () => null
  return new Proxy(
    { __esModule: true },
    { get: (target, prop) => (prop in target ? (target as Record<string | symbol, unknown>)[prop] : IconStub) },
  )
})

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
  useLocale: () => 'pl-PL',
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: async () => ({ ok: true, result: { entries: [] } }),
}))

jest.mock('../hooks/useUnitPriceDisplayEnabled', () => ({
  useUnitPriceDisplayEnabled: () => ({ enabled: false, isLoading: false }),
}))

import { ProductUomSection } from '../ProductUomSection'

// Fires one `change` event per character, re-reading the input's own DOM value between
// keystrokes — a single `fireEvent.change(input, { value: 'full string' })` does not exercise
// the eager re-parse-and-re-serialize path that used to corrupt a value typed character by
// character (issue #5828).
function typeSequentially(input: HTMLInputElement, text: string) {
  for (const char of text) {
    fireEvent.change(input, { target: { value: input.value + char } })
  }
}

function renderSection() {
  const setValue = jest.fn()
  function Harness() {
    const [values, setValues] = React.useState(BASE_INITIAL_VALUES)
    const handleSetValue = (id: string, next: unknown) => {
      setValue(id, next)
      setValues((current) => ({ ...current, [id]: next }))
    }
    return <ProductUomSection values={values} errors={{}} setValue={handleSetValue} />
  }
  render(<Harness />)
  return setValue
}

describe('ProductUomSection locale decimal separator (issue #5828)', () => {
  it('keeps a comma-decimal default sales quantity intact while typing it character by character', () => {
    renderSection()
    const input = document.getElementById(
      'catalog-product-uom-default-sales-quantity',
    ) as HTMLInputElement
    // The field defaults to "1" — continue typing from there rather than clearing first, since
    // this component intentionally falls back to "1" whenever the field is empty.
    expect(input.value).toBe('1')
    typeSequentially(input, ',25')
    expect(input.value).toBe('1,25')
  })

  it('keeps a comma-decimal conversion factor intact while typing it character by character', () => {
    renderSection()
    fireEvent.click(screen.getByText('Add conversion'))
    const input = document.querySelector(
      '[id^="catalog-product-uom-conversion-factor-"]',
    ) as HTMLInputElement
    typeSequentially(input, '12,5')
    expect(input.value).toBe('12,5')
  })

  it('still accepts a dot typed character by character', () => {
    renderSection()
    const input = document.getElementById(
      'catalog-product-uom-default-sales-quantity',
    ) as HTMLInputElement
    // Same "field defaults to 1" behavior as the comma-decimal test above.
    expect(input.value).toBe('1')
    typeSequentially(input, '.25')
    expect(input.value).toBe('1.25')
  })
})
