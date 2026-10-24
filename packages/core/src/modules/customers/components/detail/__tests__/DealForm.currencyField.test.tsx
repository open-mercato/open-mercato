/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import type { CrudFormProps } from '@open-mercato/ui/backend/CrudForm'
import type { DictionaryEntrySelectProps, DictionaryOption } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'
import { DealForm } from '../DealForm'

const mockCurrencyEntries = [
  { id: 'jpy', value: 'jpy', label: 'JPY – Japanese Yen' },
  { id: 'usd', value: 'USD', label: 'USD – US Dollar' },
  { id: 'kes', value: 'KES', label: 'Kenyan Shilling' },
  { id: 'eur', value: 'EUR', label: 'EUR' },
  { id: 'chf', value: 'CHF', label: '' },
  { id: 'gbp', value: 'GBP', label: 'GBP – British Pound' },
  { id: 'pln', value: 'PLN', label: 'Polish Zloty' },
]

jest.mock('../hooks/useCurrencyDictionary', () => ({
  useCurrencyDictionary: () => ({
    data: { id: 'currency', entries: mockCurrencyEntries },
    error: null,
    isLoading: false,
    refetch: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ ok: true, result: { items: [] } })),
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => {
  const React = jest.requireActual<typeof import('react')>('react')
  return {
    CrudForm: ({ fields, initialValues, onSubmit }: CrudFormProps<Record<string, unknown>>) => {
      const [values, setValues] = React.useState(initialValues ?? {})
      const currencyField = fields.find((field) => field.id === 'valueCurrency')
      if (!currencyField || currencyField.type !== 'custom') return null
      return (
        <form onSubmit={(event) => { event.preventDefault(); void onSubmit?.(values) }}>
          {currencyField.component({
            id: 'valueCurrency',
            value: values.valueCurrency,
            setValue: (value) => setValues((previous) => ({ ...previous, valueCurrency: value })),
          })}
          <button type="submit">Save currency</button>
        </form>
      )
    },
  }
})

jest.mock('@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect', () => {
  const React = jest.requireActual<typeof import('react')>('react')
  return {
    DictionaryEntrySelect: ({ value, onChange, fetchOptions }: DictionaryEntrySelectProps) => {
      const [options, setOptions] = React.useState<DictionaryOption[]>([])
      React.useEffect(() => { void fetchOptions().then(setOptions) }, [fetchOptions])
      return (
        <div>
          <span data-testid="selected-currency">{options.find((option) => option.value === value)?.label}</span>
          {options.map((option) => (
            <button key={option.value} type="button" onClick={() => onChange(option.value)}>
              {option.label}
            </button>
          ))}
        </div>
      )
    },
  }
})

describe('DealForm currency field', () => {
  it.each(['create', 'edit'] as const)('formats options and submits the selected code in %s mode', async (mode) => {
    const onSubmit = jest.fn(async () => {})
    renderWithProviders(
      <DealForm
        mode={mode}
        initialValues={{ title: 'Currency regression', valueCurrency: 'USD' }}
        initialPipelineOptions={[]}
        onSubmit={onSubmit}
      />,
    )

    await screen.findByRole('button', { name: 'JPY – Japanese Yen' })
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'EUR',
      'USD – US Dollar',
      'GBP – British Pound',
      'PLN – Polish Zloty',
      'CHF',
      'JPY – Japanese Yen',
      'KES – Kenyan Shilling',
      'Save currency',
    ])
    expect(screen.getByTestId('selected-currency').textContent).toBe('USD – US Dollar')

    fireEvent.click(screen.getByRole('button', { name: 'JPY – Japanese Yen' }))
    expect(screen.getByTestId('selected-currency').textContent).toBe('JPY – Japanese Yen')
    fireEvent.click(screen.getByRole('button', { name: 'Save currency' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      base: expect.objectContaining({ valueCurrency: 'JPY' }),
      custom: {},
    }))
  })
})
