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

import { PricingSection, PriceListEditor } from '../LinkTemplateForm'

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

describe('LinkTemplateForm locale decimal separator (issue #5828)', () => {
  it('accepts a comma-decimal fixed price amount', () => {
    const setValue = renderPricingSection({ pricingMode: 'fixed' })
    const amountInput = screen.getByPlaceholderText('150')
    fireEvent.change(amountInput, { target: { value: '110,70' } })
    expect(setValue).toHaveBeenLastCalledWith('fixedPriceAmount', 110.7)
  })

  it('accepts a comma-decimal compare-at price', () => {
    const setValue = renderPricingSection({ pricingMode: 'fixed' })
    const compareInput = screen.getByPlaceholderText('200')
    fireEvent.change(compareInput, { target: { value: '150,50' } })
    expect(setValue).toHaveBeenLastCalledWith('fixedPriceOriginalAmount', 150.5)
  })

  it('accepts comma-decimal custom-amount min/max', () => {
    const setValue = renderPricingSection({ pricingMode: 'custom_amount' })
    const minInput = screen.getByPlaceholderText('10')
    fireEvent.change(minInput, { target: { value: '10,50' } })
    expect(setValue).toHaveBeenLastCalledWith('customAmountMin', 10.5)

    const maxInput = screen.getByPlaceholderText('500')
    fireEvent.change(maxInput, { target: { value: '500,25' } })
    expect(setValue).toHaveBeenLastCalledWith('customAmountMax', 500.25)
  })

  it('still accepts a dot, so the workaround users learned keeps working', () => {
    const setValue = renderPricingSection({ pricingMode: 'fixed' })
    const amountInput = screen.getByPlaceholderText('150')
    fireEvent.change(amountInput, { target: { value: '110.70' } })
    expect(setValue).toHaveBeenLastCalledWith('fixedPriceAmount', 110.7)
  })

  it('reports an unparseable fixed amount as null rather than NaN', () => {
    const setValue = renderPricingSection({ pricingMode: 'fixed' })
    const amountInput = screen.getByPlaceholderText('150')
    fireEvent.change(amountInput, { target: { value: 'abc' } })
    expect(setValue).toHaveBeenLastCalledWith('fixedPriceAmount', null)
  })

  it('parses a comma-decimal amount in a price list row', () => {
    const onChange = jest.fn()
    render(
      <PriceListEditor
        value={[{ id: 'item-1', description: 'Item', amount: 0, currencyCode: 'USD' }]}
        onChange={onChange}
      />,
    )
    const amountInput = screen.getByLabelText('checkout.linkTemplateForm.priceList.aria.amount')
    fireEvent.change(amountInput, { target: { value: '25,99' } })
    const lastCall = onChange.mock.calls.at(-1)?.[0]
    expect(lastCall?.[0]?.amount).toBe(25.99)
  })
})
