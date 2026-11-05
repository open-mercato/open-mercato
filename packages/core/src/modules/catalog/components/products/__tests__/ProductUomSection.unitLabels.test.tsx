/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { CATALOG_UNIT_DEFAULTS } from '../../../lib/unitLabels'
import { BASE_INITIAL_VALUES, createProductUnitConversionDraft } from '../productForm'
import en from '../../../i18n/en.json'
import pl from '../../../i18n/pl.json'

jest.mock('lucide-react', () => {
  const IconStub = () => null
  return new Proxy(
    { __esModule: true },
    { get: (target, property) => (property in target ? (target as Record<string | symbol, unknown>)[property] : IconStub) },
  )
})

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))
jest.mock('../hooks/useUnitPriceDisplayEnabled', () => ({
  useUnitPriceDisplayEnabled: () => ({ enabled: false, isLoading: false }),
}))

import { ProductUomSection } from '../ProductUomSection'

const mockApiCall = jest.mocked(apiCall)
const values = {
  ...BASE_INITIAL_VALUES,
  defaultUnit: 'g',
  defaultSalesUnit: 'cl',
  unitConversions: [createProductUnitConversionDraft({ unitCode: 'dozen', toBaseFactor: '12' })],
}

function section(locale: 'en' | 'pl', setValue = jest.fn()) {
  return (
    <I18nProvider locale={locale} dict={locale === 'pl' ? pl : en}>
      <ProductUomSection values={values} errors={{}} setValue={setValue} />
    </I18nProvider>
  )
}

function openDropdown(id: string) {
  const trigger = document.getElementById(id)
  if (!trigger) throw new Error(`Missing unit selector: ${id}`)
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  return screen.getByRole('listbox')
}

beforeEach(() => {
  mockApiCall.mockReset()
  mockApiCall.mockResolvedValue({
    ok: true,
    status: 200,
    response: new Response(),
    result: { entries: CATALOG_UNIT_DEFAULTS },
  })
})

describe('ProductUomSection translated unit labels', () => {
  it('shows Polish labels for all built-in units in each selector and the conversion preview', async () => {
    render(section('pl'))
    await waitFor(() => expect(document.getElementById('catalog-product-uom-base-unit')).toHaveTextContent('Gram (masa)'))
    expect(document.getElementById('catalog-product-uom-sales-unit')).toHaveTextContent('Centylitr (objętość)')
    expect(document.getElementById('catalog-product-uom-conversion-unit-0')).toHaveTextContent('Tuzin (sztuki)')
    expect(screen.getByText(/1 Tuzin \(sztuki\) = 12 Gram \(masa\)/)).toBeInTheDocument()

    for (const id of ['catalog-product-uom-base-unit', 'catalog-product-uom-sales-unit', 'catalog-product-uom-conversion-unit-0']) {
      const dropdown = openDropdown(id)
      for (const unit of CATALOG_UNIT_DEFAULTS) {
        expect(within(dropdown).getByRole('option', { name: pl[unit.labelKey as keyof typeof pl], exact: true })).toBeInTheDocument()
        expect(within(dropdown).queryByRole('option', { name: unit.label, exact: true })).toBeNull()
      }
      fireEvent.keyDown(dropdown, { key: 'Escape' })
    }
  })

  it('updates labels and ordering when the locale changes without reloading the dictionary', async () => {
    const view = render(section('en'))
    await waitFor(() => expect(document.getElementById('catalog-product-uom-base-unit')).toHaveTextContent('Gram (weight)'))
    view.rerender(section('pl'))
    expect(document.getElementById('catalog-product-uom-base-unit')).toHaveTextContent('Gram (masa)')
    const dropdown = openDropdown('catalog-product-uom-base-unit')
    const labels = within(dropdown).getAllByRole('option').map((option) => option.textContent)
    expect(labels).toEqual(CATALOG_UNIT_DEFAULTS.map((unit) => pl[unit.labelKey as keyof typeof pl]).sort((left, right) => left.localeCompare(right, 'pl')))
    expect(mockApiCall).toHaveBeenCalledTimes(1)
  })

  it('preserves custom labels, missing-label fallbacks and selected unit codes', async () => {
    mockApiCall.mockResolvedValue({
      ok: true,
      status: 200,
      response: new Response(),
      result: { entries: [
        { value: 'g', label: 'Our gram unit' },
        { value: 'pallet', label: 'Shipping pallet' },
        { value: 'cl' },
        { value: '', label: 'Invalid unit' },
      ] },
    })
    const setValue = jest.fn()
    render(section('pl', setValue))
    await waitFor(() => expect(document.getElementById('catalog-product-uom-base-unit')).toHaveTextContent('Our gram unit'))
    const dropdown = openDropdown('catalog-product-uom-base-unit')
    expect(within(dropdown).getByRole('option', { name: 'cl', exact: true })).toBeInTheDocument()
    expect(within(dropdown).queryByRole('option', { name: 'Invalid unit' })).toBeNull()
    fireEvent.click(within(dropdown).getByRole('option', { name: 'Shipping pallet' }))
    expect(setValue).toHaveBeenCalledWith('defaultUnit', 'pallet')
  })
})
