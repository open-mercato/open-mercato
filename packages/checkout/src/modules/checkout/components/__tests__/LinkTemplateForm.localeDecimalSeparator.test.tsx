/**
 * @jest-environment jsdom
 *
 * UI-level regression test for issue #5828.
 *
 * `PricingSection`'s fixed/custom-amount fields and `PriceListEditor`'s per-item amount
 * field used to parse the typed string with the JS global `Number()`, which only accepts
 * `.` as a decimal separator. Under a comma-decimal application locale (Polish here), typing
 * the same value the rest of the screen displays — `110,70` — produced `NaN` instead of being
 * accepted, the same defect class #5827 fixed for the shared `CrudForm`/`InjectedField` seams
 * and the sales `LineItemDialog` while deliberately leaving these checkout fields alone.
 *
 * The locale is pinned to `pl-PL` rather than left to the runner: CI resolves `C.UTF-8` to an
 * en-US ICU default, so an `en-US` pin passes on the buggy implementation too and a revert of
 * the locale-aware parse would stay green.
 */
import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

jest.mock('lucide-react', () => {
  const IconStub = () => null
  return new Proxy(
    { __esModule: true },
    { get: (target, prop) => (prop in target ? (target as Record<string | symbol, unknown>)[prop] : IconStub) },
  )
})

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  RecordNotFoundState: () => null,
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
  useLocale: () => 'pl-PL',
}))

jest.mock('../CheckoutCurrencySelect', () => ({
  CheckoutCurrencySelect: () => null,
}))

jest.mock('../CustomerFieldsEditor', () => ({
  CustomerFieldsEditor: () => null,
}))

jest.mock('../GatewaySettingsFields', () => ({
  GatewaySettingsFields: () => null,
}))

jest.mock('../LogoUploadField', () => ({
  LogoUploadField: () => null,
}))

import { PricingSection, PriceListEditor, toSubmittedAmount } from '../LinkTemplateForm'

function renderPricingSection(initialValues: Record<string, unknown>) {
  const setValue = jest.fn()
  function Harness() {
    const [values, setValues] = React.useState(initialValues)
    const handleSetValue = (id: string, next: unknown) => {
      setValue(id, next)
      setValues((current) => ({ ...current, [id]: next }))
    }
    return (
      <PricingSection
        values={values}
        setValue={handleSetValue}
        errors={{}}
      />
    )
  }
  render(<Harness />)
  return setValue
}

// Fires one `change` event per character, re-reading the input's own DOM value between
// keystrokes — a single `fireEvent.change(input, { value: 'full string' })` does not exercise
// the eager re-parse-and-re-serialize path that used to corrupt a value typed character by
// character (issue #5828: typing "110,70" ended up submitted as "11070").
function typeSequentially(input: HTMLInputElement, text: string) {
  for (const char of text) {
    fireEvent.change(input, { target: { value: input.value + char } })
  }
}

describe('LinkTemplateForm locale decimal separator (issue #5828)', () => {
  it('keeps a comma-decimal fixed price amount intact while typing it character by character', () => {
    renderPricingSection({ pricingMode: 'fixed' })
    const amountInput = screen.getByPlaceholderText('150') as HTMLInputElement
    typeSequentially(amountInput, '110,70')
    // Before the fix, the field eagerly re-parsed and re-serialized the number on every
    // keystroke, which dropped the in-progress comma and left "11070" once typing finished.
    expect(amountInput.value).toBe('110,70')
  })

  it('keeps a comma-decimal compare-at price intact while typing it character by character', () => {
    renderPricingSection({ pricingMode: 'fixed' })
    const compareInput = screen.getByPlaceholderText('200') as HTMLInputElement
    typeSequentially(compareInput, '150,50')
    expect(compareInput.value).toBe('150,50')
  })

  it('keeps comma-decimal custom-amount min/max intact while typing them character by character', () => {
    renderPricingSection({ pricingMode: 'custom_amount' })
    const minInput = screen.getByPlaceholderText('10') as HTMLInputElement
    typeSequentially(minInput, '10,50')
    expect(minInput.value).toBe('10,50')

    const maxInput = screen.getByPlaceholderText('500') as HTMLInputElement
    typeSequentially(maxInput, '500,25')
    expect(maxInput.value).toBe('500,25')
  })

  it('still accepts a dot typed character by character, so the workaround users learned keeps working', () => {
    renderPricingSection({ pricingMode: 'fixed' })
    const amountInput = screen.getByPlaceholderText('150') as HTMLInputElement
    typeSequentially(amountInput, '110.70')
    expect(amountInput.value).toBe('110.70')
  })

  it('keeps a comma-decimal amount intact while typing it character by character in a price list row', () => {
    const onChange = jest.fn()
    const { rerender } = render(
      <PriceListEditor
        value={[{ id: 'item-1', description: 'Item', amount: '', currencyCode: 'USD' }]}
        onChange={onChange}
      />,
    )
    const amountInput = screen.getByLabelText(
      'checkout.linkTemplateForm.priceList.aria.amount',
    ) as HTMLInputElement
    for (const char of '25,99') {
      fireEvent.change(amountInput, { target: { value: amountInput.value + char } })
      const lastItems = onChange.mock.calls.at(-1)?.[0]
      rerender(<PriceListEditor value={lastItems} onChange={onChange} />)
    }
    expect(amountInput.value).toBe('25,99')
  })

  describe('toSubmittedAmount (converts the raw typed text to a number at submit time)', () => {
    it('parses a comma-decimal value', () => {
      expect(toSubmittedAmount('110,70', 'pl-PL')).toBe(110.7)
    })

    it('still parses a dot-decimal value', () => {
      expect(toSubmittedAmount('110.70', 'pl-PL')).toBe(110.7)
    })

    it('passes an already-numeric value through unchanged', () => {
      expect(toSubmittedAmount(150, 'pl-PL')).toBe(150)
    })

    it('returns null for unparseable or blank input, never a silent 0 or NaN', () => {
      expect(toSubmittedAmount('abc', 'pl-PL')).toBeNull()
      expect(toSubmittedAmount('', 'pl-PL')).toBeNull()
      expect(toSubmittedAmount(null, 'pl-PL')).toBeNull()
    })
  })
})
