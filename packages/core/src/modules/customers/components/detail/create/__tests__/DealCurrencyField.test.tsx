/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { DealCurrencyField } from '../DealCurrencyField'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

const currencyEntries = [
  { id: '1', value: 'jpy', label: 'JPY – Japanese Yen', color: null, icon: null },
  { id: '2', value: 'USD', label: 'USD – US Dollar', color: null, icon: null },
  { id: '3', value: 'KES', label: 'Kenyan Shilling', color: null, icon: null },
  { id: '4', value: 'EUR', label: 'EUR', color: null, icon: null },
  { id: '5', value: 'CHF', label: '', color: null, icon: null },
]

jest.mock('../../hooks/useCurrencyDictionary', () => ({
  useCurrencyDictionary: () => ({
    data: { id: 'dict', entries: currencyEntries },
    error: null,
    isLoading: false,
    refetch: jest.fn(),
  }),
}))

jest.mock('@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect', () => {
  const React = require('react')
  return {
    DictionaryEntrySelect: ({ value, onChange, fetchOptions }: any) => {
      const [options, setOptions] = React.useState([])
      React.useEffect(() => {
        fetchOptions().then(setOptions)
      }, [fetchOptions])
      const selected = options.find((option: any) => option.value === value)
      return React.createElement(
        'div',
        null,
        React.createElement('span', { 'data-testid': 'selected-value' }, selected ? selected.label : ''),
        options.map((option: any) =>
          React.createElement(
            'button',
            { key: option.value, type: 'button', onClick: () => onChange(option.value) },
            option.label,
          ),
        ),
      )
    },
  }
})

describe('DealCurrencyField', () => {
  it('shows each currency code once in options and the selected value', async () => {
    const onChange = jest.fn()
    render(<DealCurrencyField value="USD" onChange={onChange} />)

    const buttons = await screen.findAllByRole('button')
    expect(buttons.map((button) => button.textContent)).toEqual([
      'EUR',
      'USD – US Dollar',
      'CHF',
      'JPY – Japanese Yen',
      'KES – Kenyan Shilling',
    ])
    expect(screen.getByTestId('selected-value').textContent).toBe('USD – US Dollar')

    fireEvent.click(screen.getByRole('button', { name: 'JPY – Japanese Yen' }))
    expect(onChange).toHaveBeenCalledWith('JPY')
  })
})
