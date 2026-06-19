/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { SuffixInput } from '../SuffixInput'

describe('SuffixInput', () => {
  it('renders the suffix adornment alongside the input', () => {
    render(<SuffixInput suffix="PLN" value="" onChange={() => {}} placeholder="0" />)
    expect(screen.getByText('PLN')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('forwards value and change events to the underlying input', () => {
    // Read the value synchronously inside the handler: this input is controlled, so React resets
    // the (pooled) event target back to the `value` prop after the change, making a post-hoc read stale.
    const seen: string[] = []
    render(<SuffixInput suffix="%" value="42" onChange={(event) => seen.push(event.target.value)} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('42')
    fireEvent.change(input, { target: { value: '55' } })
    expect(seen).toEqual(['55'])
  })

  it('forwards arbitrary input props (placeholder, disabled, aria-invalid, inputMode)', () => {
    render(
      <SuffixInput
        suffix="USD"
        value=""
        onChange={() => {}}
        placeholder="0"
        disabled
        aria-invalid
        inputMode="decimal"
      />,
    )
    const input = screen.getByPlaceholderText('0') as HTMLInputElement
    expect(input).toBeDisabled()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('inputmode', 'decimal')
  })
})
