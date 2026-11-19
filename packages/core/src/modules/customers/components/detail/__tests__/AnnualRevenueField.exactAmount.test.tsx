/**
 * @jest-environment jsdom
 */

jest.mock('../hooks/useCurrencyDictionary', () => ({
  useCurrencyDictionary: () => ({
    data: { entries: [{ value: 'USD', label: 'USD' }, { value: 'EUR', label: 'EUR' }], defaultCode: null },
    error: null,
    isLoading: false,
    refetch: jest.fn(async () => ({ entries: [], defaultCode: null })),
  }),
}))

jest.mock('@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect', () => ({
  DictionaryEntrySelect: ({ value, onChange }: { value?: string; onChange: (next: string | null) => void }) => (
    <select aria-label="currency" value={value ?? ''} onChange={(event) => onChange(event.target.value || null)}>
      <option value="">-</option>
      <option value="USD">USD</option>
      <option value="EUR">EUR</option>
    </select>
  ),
}))

import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { AnnualRevenueField } from '../AnnualRevenueField'

const EXACT_AMOUNT = '25.123456789012345678'

function renderField(amount: string | null, onSave: jest.Mock) {
  renderWithProviders(
    <AnnualRevenueField label="Annual revenue" amount={amount} currency="USD" emptyLabel="Not set" onSave={onSave} />,
  )
  fireEvent.click(screen.getByRole('button', { name: /annual revenue/i }))
}

function clickSave() {
  const saveButton = screen.getAllByRole('button').find((button) => /save/i.test(button.textContent ?? ''))
  if (!saveButton) throw new Error('[internal] save button not found')
  fireEvent.click(saveButton)
}

describe('AnnualRevenueField - exact amount', () => {
  it('keeps the exact amount when only the currency changes', async () => {
    const onSave = jest.fn(async () => {})
    renderField(EXACT_AMOUNT, onSave)
    fireEvent.change(screen.getByLabelText('currency'), { target: { value: 'EUR' } })
    clickSave()
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith({ amount: Number(EXACT_AMOUNT), amountExact: EXACT_AMOUNT, currency: 'EUR' })
  })

  it('sends null for a cleared amount', async () => {
    const onSave = jest.fn(async () => {})
    renderField(EXACT_AMOUNT, onSave)
    fireEvent.change(screen.getByPlaceholderText('Enter amount'), { target: { value: '' } })
    clickSave()
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith({ amount: null, amountExact: null, currency: 'USD' })
  })
})
