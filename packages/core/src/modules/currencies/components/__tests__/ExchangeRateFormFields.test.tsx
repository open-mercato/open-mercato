/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ExchangeRateInput, ExchangeRateMetadataList } from '../ExchangeRateFormFields'

function renderInput(values: Record<string, unknown>, setValue = jest.fn()) {
  renderWithProviders(
    <ExchangeRateInput id="rate" label="Exchange Rate" value="4.2537125" values={values} setValue={setValue} />,
  )
  return setValue
}

describe('ExchangeRateInput', () => {
  it('shows a plain field until both currencies are chosen', () => {
    renderInput({ fromCurrencyCode: 'EUR' })
    const input = screen.getByRole('textbox', { name: 'Exchange Rate' })
    expect(input).not.toHaveAttribute('aria-describedby')
    expect(input).not.toHaveAttribute('placeholder')
    expect(screen.queryByText('1 EUR =')).toBeNull()
  })

  it('reads as a sentence and announces the direction once both currencies are set', () => {
    renderInput({ fromCurrencyCode: 'eur', toCurrencyCode: 'PLN' })
    const input = screen.getByRole('textbox', { name: 'Exchange Rate' })
    expect(input).toHaveAccessibleDescription('1 EUR = PLN')
    expect(input).toHaveValue('4.2537125')
  })

  it('stores an exact decimal string', () => {
    const setValue = renderInput({ fromCurrencyCode: 'EUR', toCurrencyCode: 'PLN' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Exchange Rate' }), {
      target: { value: '4.25371251234567890123' },
    })
    expect(setValue).toHaveBeenLastCalledWith('4.25371251234567890123')
  })
})

describe('ExchangeRateMetadataList', () => {
  it('lists each metadata key and value', () => {
    renderWithProviders(<ExchangeRateMetadataList metadata={{ tableNumber: '223/C/NBP/2026', page: 2 }} />)
    expect(screen.getByText('tableNumber')).toBeInTheDocument()
    expect(screen.getByText('223/C/NBP/2026')).toHaveClass('break-words')
    expect(screen.getByText('2')).toBeInTheDocument()
  })
})
