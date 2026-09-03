jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}))

import * as React from 'react'
import { render, fireEvent } from '@testing-library/react'
import {
  DurationInput,
  formatSingleUnitDuration,
  isCompositeCompatibleDuration,
  parseSingleUnitDuration,
} from '../DurationInput'

describe('formatSingleUnitDuration', () => {
  it('serializes seconds to PT30S', () => {
    expect(formatSingleUnitDuration(30, 'seconds')).toBe('PT30S')
  })

  it('serializes minutes to PT5M', () => {
    expect(formatSingleUnitDuration(5, 'minutes')).toBe('PT5M')
  })

  it('serializes hours to PT2H', () => {
    expect(formatSingleUnitDuration(2, 'hours')).toBe('PT2H')
  })

  it('serializes days to P1D', () => {
    expect(formatSingleUnitDuration(1, 'days')).toBe('P1D')
  })
})

describe('parseSingleUnitDuration', () => {
  it('parses PT30S', () => {
    expect(parseSingleUnitDuration('PT30S')).toEqual({ amount: 30, unit: 'seconds' })
  })

  it('parses PT5M', () => {
    expect(parseSingleUnitDuration('PT5M')).toEqual({ amount: 5, unit: 'minutes' })
  })

  it('parses PT2H', () => {
    expect(parseSingleUnitDuration('PT2H')).toEqual({ amount: 2, unit: 'hours' })
  })

  it('parses P1D', () => {
    expect(parseSingleUnitDuration('P1D')).toEqual({ amount: 1, unit: 'days' })
  })

  it('round-trips every unit', () => {
    for (const serialized of ['PT30S', 'PT5M', 'PT2H', 'P1D']) {
      const parsed = parseSingleUnitDuration(serialized)
      expect(parsed).not.toBeNull()
      if (parsed) {
        expect(formatSingleUnitDuration(parsed.amount, parsed.unit)).toBe(serialized)
      }
    }
  })

  it('rejects interpolation templates', () => {
    expect(parseSingleUnitDuration('{{context.x}}')).toBeNull()
  })

  it('rejects multi-unit ISO durations', () => {
    expect(parseSingleUnitDuration('PT1H30M')).toBeNull()
  })

  it('rejects the simple form', () => {
    expect(parseSingleUnitDuration('5m')).toBeNull()
  })

  it('rejects garbage', () => {
    expect(parseSingleUnitDuration('not-a-duration')).toBeNull()
  })

  it('rejects the empty string', () => {
    expect(parseSingleUnitDuration('')).toBeNull()
  })
})

describe('isCompositeCompatibleDuration', () => {
  it('treats empty and undefined values as composite-compatible', () => {
    expect(isCompositeCompatibleDuration('')).toBe(true)
    expect(isCompositeCompatibleDuration(undefined)).toBe(true)
    expect(isCompositeCompatibleDuration(null)).toBe(true)
  })

  it('accepts single-unit ISO values', () => {
    expect(isCompositeCompatibleDuration('PT30S')).toBe(true)
    expect(isCompositeCompatibleDuration('PT5M')).toBe(true)
    expect(isCompositeCompatibleDuration('PT2H')).toBe(true)
    expect(isCompositeCompatibleDuration('P1D')).toBe(true)
  })

  it('rejects templates, multi-unit values, simple form, and garbage', () => {
    expect(isCompositeCompatibleDuration('{{context.x}}')).toBe(false)
    expect(isCompositeCompatibleDuration('PT1H30M')).toBe(false)
    expect(isCompositeCompatibleDuration('5m')).toBe(false)
    expect(isCompositeCompatibleDuration('garbage')).toBe(false)
  })
})

describe('DurationInput', () => {
  it('renders composite mode with the parsed amount for a single-unit value', () => {
    const { getByLabelText } = render(<DurationInput value="PT5M" onChange={jest.fn()} />)
    expect((getByLabelText('Duration amount') as HTMLInputElement).value).toBe('5')
    expect(getByLabelText('Duration unit')).toBeInTheDocument()
  })

  it('renders empty composite mode when value is empty', () => {
    const { getByLabelText } = render(<DurationInput value="" onChange={jest.fn()} />)
    expect((getByLabelText('Duration amount') as HTMLInputElement).value).toBe('')
  })

  it('serializes amount edits with the unit derived from the current value', () => {
    const onChange = jest.fn()
    const { getByLabelText } = render(<DurationInput value="PT2H" onChange={onChange} />)
    fireEvent.change(getByLabelText('Duration amount'), { target: { value: '3' } })
    expect(onChange).toHaveBeenCalledWith('PT3H')
  })

  it('serializes day values with the P prefix and no T segment', () => {
    const onChange = jest.fn()
    const { getByLabelText } = render(<DurationInput value="P1D" onChange={onChange} />)
    fireEvent.change(getByLabelText('Duration amount'), { target: { value: '2' } })
    expect(onChange).toHaveBeenCalledWith('P2D')
  })

  it('emits an empty string when the amount is cleared', () => {
    const onChange = jest.fn()
    const { getByLabelText } = render(<DurationInput value="PT5M" onChange={onChange} />)
    fireEvent.change(getByLabelText('Duration amount'), { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('falls back to raw mode for interpolation templates', () => {
    const { getByLabelText } = render(
      <DurationInput value="{{context.timeout}}" onChange={jest.fn()} />
    )
    expect((getByLabelText('Duration expression') as HTMLInputElement).value).toBe(
      '{{context.timeout}}'
    )
  })

  it('falls back to raw mode for multi-unit ISO values', () => {
    const { getByLabelText } = render(<DurationInput value="PT1H30M" onChange={jest.fn()} />)
    expect((getByLabelText('Duration expression') as HTMLInputElement).value).toBe('PT1H30M')
  })

  it('falls back to raw mode for the simple form', () => {
    const { getByLabelText } = render(<DurationInput value="5m" onChange={jest.fn()} />)
    expect((getByLabelText('Duration expression') as HTMLInputElement).value).toBe('5m')
  })

  it('falls back to raw mode for unparseable values', () => {
    const { getByLabelText } = render(<DurationInput value="garbage" onChange={jest.fn()} />)
    expect((getByLabelText('Duration expression') as HTMLInputElement).value).toBe('garbage')
  })

  it('passes raw edits through unchanged', () => {
    const onChange = jest.fn()
    const { getByLabelText } = render(<DurationInput value="PT1H30M" onChange={onChange} />)
    fireEvent.change(getByLabelText('Duration expression'), {
      target: { value: '{{context.deadline}}' },
    })
    expect(onChange).toHaveBeenCalledWith('{{context.deadline}}')
  })

  it('switches composite to raw keeping the serialized string', () => {
    const onChange = jest.fn()
    const { getByLabelText, getByRole } = render(
      <DurationInput value="PT5M" onChange={onChange} />
    )
    fireEvent.click(getByRole('button', { name: 'Edit as text' }))
    expect((getByLabelText('Duration expression') as HTMLInputElement).value).toBe('PT5M')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('switches raw back to composite when the value parses to a single unit', () => {
    const { getByLabelText, getByRole } = render(
      <DurationInput value="PT5M" onChange={jest.fn()} />
    )
    fireEvent.click(getByRole('button', { name: 'Edit as text' }))
    fireEvent.click(getByRole('button', { name: 'Use picker' }))
    expect((getByLabelText('Duration amount') as HTMLInputElement).value).toBe('5')
  })

  it('disables the composite toggle while the raw value is not single-unit parseable', () => {
    const { getByRole } = render(<DurationInput value="PT1H30M" onChange={jest.fn()} />)
    expect(
      (getByRole('button', { name: 'Use picker' }) as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('allows switching back to composite from raw mode with an empty value', () => {
    const { getByLabelText, getByRole } = render(<DurationInput value="" onChange={jest.fn()} />)
    fireEvent.click(getByRole('button', { name: 'Edit as text' }))
    fireEvent.click(getByRole('button', { name: 'Use picker' }))
    expect((getByLabelText('Duration amount') as HTMLInputElement).value).toBe('')
  })

  it('honors a custom aria-label on the primary input in both modes', () => {
    const { getByLabelText, getByRole } = render(
      <DurationInput value="PT5M" onChange={jest.fn()} aria-label="Deadline" />
    )
    expect((getByLabelText('Deadline') as HTMLInputElement).value).toBe('5')
    fireEvent.click(getByRole('button', { name: 'Edit as text' }))
    expect((getByLabelText('Deadline') as HTMLInputElement).value).toBe('PT5M')
  })

  it('disables inputs and ignores edits when disabled', () => {
    const onChange = jest.fn()
    const { getByLabelText, getByRole } = render(
      <DurationInput value="PT5M" onChange={onChange} disabled />
    )
    expect((getByLabelText('Duration amount') as HTMLInputElement).disabled).toBe(true)
    expect(
      (getByRole('button', { name: 'Edit as text' }) as HTMLButtonElement).disabled
    ).toBe(true)
  })
})
