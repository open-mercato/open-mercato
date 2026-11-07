/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { AnnualRevenueField } from '../AnnualRevenueField'

jest.mock('../hooks/useCurrencyDictionary', () => ({
  useCurrencyDictionary: () => ({
    data: { id: 'currency', entries: [] },
    error: null,
    isLoading: false,
    refetch: jest.fn().mockResolvedValue({ id: 'currency', entries: [] }),
  }),
}))

jest.mock('@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect', () => ({
  DictionaryEntrySelect: () => <div data-testid="currency-select" />,
}))

let currentLocale = 'pl-PL'
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
  useLocale: () => currentLocale,
}))

describe('AnnualRevenueField comma-decimal input (#8642)', () => {
  beforeEach(() => {
    currentLocale = 'pl-PL'
  })

  it('renders the editor as a text input instead of a number input', () => {
    render(
      <AnnualRevenueField
        label="Annual revenue"
        amount={null}
        currency={null}
        emptyLabel="Not provided"
        onSave={jest.fn()}
      />,
    )
    fireEvent.click(screen.getByText('ui.forms.actions.edit'))
    const input = screen.getByPlaceholderText('Enter amount')
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveAttribute('inputMode', 'decimal')
  })

  it('saves a comma-decimal amount as its locale-parsed numeric value instead of multiplying it by 100', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined)
    render(
      <AnnualRevenueField
        label="Annual revenue"
        amount={null}
        currency={null}
        emptyLabel="Not provided"
        onSave={onSave}
      />,
    )
    fireEvent.click(screen.getByText('ui.forms.actions.edit'))
    const input = screen.getByPlaceholderText('Enter amount')
    fireEvent.change(input, { target: { value: '1234,50' } })
    fireEvent.click(screen.getByText('ui.forms.actions.save'))

    await Promise.resolve()
    await Promise.resolve()

    expect(onSave).toHaveBeenCalledWith({ amount: 1234.5, currency: null })
  })

  it('rejects an unparseable amount instead of silently coercing it to NaN or 0', async () => {
    const onSave = jest.fn()
    render(
      <AnnualRevenueField
        label="Annual revenue"
        amount={null}
        currency={null}
        emptyLabel="Not provided"
        onSave={onSave}
      />,
    )
    fireEvent.click(screen.getByText('ui.forms.actions.edit'))
    const input = screen.getByPlaceholderText('Enter amount')
    fireEvent.change(input, { target: { value: 'not-a-number' } })
    fireEvent.click(screen.getByText('ui.forms.actions.save'))

    await Promise.resolve()

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('Enter a valid amount.')).toBeInTheDocument()
  })
})
