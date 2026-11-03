/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { Input } from '../input'
import { Textarea } from '../textarea'
import { CompactButton } from '../compact-button'
import { AmountInput } from '../amount-input'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => (_key: string, fallback: string) => fallback }))

describe('Input source compositions', () => {
  it('keeps interactive adornments accessible and forwards input props and ref', () => {
    const ref = React.createRef<HTMLInputElement>()
    const leading = jest.fn()
    const trailing = jest.fn()
    const onChange = jest.fn()
    render(<Input ref={ref} size={32} aria-label="Person" name="person" leading={<CompactButton aria-label="Choose emoji" onClick={leading}>🙂</CompactButton>} trailing={<CompactButton aria-label="Permission" onClick={trailing}>↓</CompactButton>} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Choose emoji' }))
    fireEvent.click(screen.getByRole('button', { name: 'Permission' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Alex' } })
    expect(leading).toHaveBeenCalledTimes(1)
    expect(trailing).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(ref.current).toBe(screen.getByRole('textbox', { name: 'Person' }))
    expect(ref.current).toHaveAttribute('name', 'person')
  })

  it('retains decorative semantics for existing icon slots', () => {
    render(<Input aria-label="Search" leftIcon={<span>Decorative search icon</span>} />)
    expect(screen.getByText('Decorative search icon').closest('[aria-hidden]')).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('Textarea source counter', () => {
  it('updates an uncontrolled draft counter and preserves native maxLength', () => {
    render(<Textarea aria-label="Note" appearance="source" showCount maxLength={200} defaultValue="Saved" />)
    expect(screen.getByText('5/200')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New text' } })
    expect(screen.getByText('8/200')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveAttribute('maxlength', '200')
  })

  it('updates controlled text and counter from parent props without leaking appearance to native HTML', () => {
    const { rerender } = render(<Textarea aria-label="Note" appearance="source" showCount maxLength={10} value="One" onChange={() => {}} />)
    rerender(<Textarea aria-label="Note" appearance="source" showCount maxLength={10} value="Updated" onChange={() => {}} disabled />)
    expect(screen.getByRole('textbox')).toHaveValue('Updated')
    expect(screen.getByText('7/10')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeDisabled()
    expect(screen.getByRole('textbox')).not.toHaveAttribute('appearance')
  })
})


describe('AmountInput source currency icon', () => {
  it('updates the asset with the controlled currency while retaining string amount changes', () => {
    const onChange = jest.fn()
    const renderCurrencyIcon = (currency: { code: string }) => <img src={`${currency.code}.svg`} alt="" />
    const { rerender } = render(<AmountInput size={32} value={{ currency: 'EUR', amount: '12.00' }} onChange={onChange} renderCurrencyIcon={renderCurrencyIcon} />)
    expect(screen.getByRole('combobox').querySelector('img')).toHaveAttribute('src', 'EUR.svg')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '15.50' } })
    expect(onChange).toHaveBeenCalledWith({ currency: 'EUR', amount: '15.50' })
    rerender(<AmountInput size={32} value={{ currency: 'USD', amount: '15.50' }} onChange={onChange} renderCurrencyIcon={renderCurrencyIcon} />)
    expect(screen.getByRole('combobox').querySelector('img')).toHaveAttribute('src', 'USD.svg')
  })
})
