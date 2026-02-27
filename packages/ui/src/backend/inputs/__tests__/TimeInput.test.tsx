jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}))

import * as React from 'react'
import { render, fireEvent } from '@testing-library/react'
import { TimeInput } from '../TimeInput'

describe('TimeInput', () => {
  it('renders with initial value', () => {
    const { getByLabelText } = render(
      <TimeInput value="09:30" onChange={jest.fn()} hourLabel="Hour" minuteLabel="Minute" />
    )
    expect((getByLabelText('Hour') as HTMLInputElement).value).toBe('09')
    expect((getByLabelText('Minute') as HTMLInputElement).value).toBe('30')
  })

  it('renders zeros when no value provided', () => {
    const { getByLabelText } = render(
      <TimeInput onChange={jest.fn()} hourLabel="Hour" minuteLabel="Minute" />
    )
    expect((getByLabelText('Hour') as HTMLInputElement).value).toBe('00')
    expect((getByLabelText('Minute') as HTMLInputElement).value).toBe('00')
  })

  it('ArrowUp on hour increments with boundary wrap (23 → 0)', () => {
    const onChange = jest.fn()
    const { getByLabelText } = render(
      <TimeInput value="23:00" onChange={onChange} hourLabel="Hour" minuteLabel="Minute" />
    )
    fireEvent.keyDown(getByLabelText('Hour'), { key: 'ArrowUp' })
    expect(onChange).toHaveBeenCalledWith('00:00')
  })

  it('ArrowDown on hour decrements with boundary wrap (0 → 23)', () => {
    const onChange = jest.fn()
    const { getByLabelText } = render(
      <TimeInput value="00:15" onChange={onChange} hourLabel="Hour" minuteLabel="Minute" />
    )
    fireEvent.keyDown(getByLabelText('Hour'), { key: 'ArrowDown' })
    expect(onChange).toHaveBeenCalledWith('23:15')
  })

  it('ArrowUp on minute increments with boundary wrap (59 → 0)', () => {
    const onChange = jest.fn()
    const { getByLabelText } = render(
      <TimeInput value="10:59" onChange={onChange} hourLabel="Hour" minuteLabel="Minute" />
    )
    fireEvent.keyDown(getByLabelText('Minute'), { key: 'ArrowUp' })
    expect(onChange).toHaveBeenCalledWith('10:00')
  })

  it('ArrowDown on minute decrements with boundary wrap (0 → 59)', () => {
    const onChange = jest.fn()
    const { getByLabelText } = render(
      <TimeInput value="10:00" onChange={onChange} hourLabel="Hour" minuteLabel="Minute" />
    )
    fireEvent.keyDown(getByLabelText('Minute'), { key: 'ArrowDown' })
    expect(onChange).toHaveBeenCalledWith('10:59')
  })

  it('ArrowUp on minute steps by minuteStep', () => {
    const onChange = jest.fn()
    const { getByLabelText } = render(
      <TimeInput value="10:00" onChange={onChange} minuteStep={15} hourLabel="Hour" minuteLabel="Minute" />
    )
    fireEvent.keyDown(getByLabelText('Minute'), { key: 'ArrowUp' })
    expect(onChange).toHaveBeenCalledWith('10:15')
  })

  it('ArrowDown on minute steps by minuteStep', () => {
    const onChange = jest.fn()
    const { getByLabelText } = render(
      <TimeInput value="10:15" onChange={onChange} minuteStep={15} hourLabel="Hour" minuteLabel="Minute" />
    )
    fireEvent.keyDown(getByLabelText('Minute'), { key: 'ArrowDown' })
    expect(onChange).toHaveBeenCalledWith('10:00')
  })

  it('clamps hour input above 23 to 23', () => {
    const onChange = jest.fn()
    const { getByLabelText } = render(
      <TimeInput value="10:00" onChange={onChange} hourLabel="Hour" minuteLabel="Minute" />
    )
    fireEvent.change(getByLabelText('Hour'), { target: { value: '25' } })
    expect(onChange).toHaveBeenCalledWith('23:00')
  })

  it('clamps minute input above 59 to 59', () => {
    const onChange = jest.fn()
    const { getByLabelText } = render(
      <TimeInput value="10:00" onChange={onChange} hourLabel="Hour" minuteLabel="Minute" />
    )
    fireEvent.change(getByLabelText('Minute'), { target: { value: '75' } })
    expect(onChange).toHaveBeenCalledWith('10:59')
  })

  it('does not call onChange on non-numeric hour input (NaN guard)', () => {
    const onChange = jest.fn()
    const { getByLabelText } = render(
      <TimeInput value="10:00" onChange={onChange} hourLabel="Hour" minuteLabel="Minute" />
    )
    fireEvent.change(getByLabelText('Hour'), { target: { value: 'abc' } })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not call onChange on key events when disabled', () => {
    const onChange = jest.fn()
    const { getByLabelText } = render(
      <TimeInput value="10:00" onChange={onChange} disabled hourLabel="Hour" minuteLabel="Minute" />
    )
    fireEvent.keyDown(getByLabelText('Hour'), { key: 'ArrowUp' })
    fireEvent.keyDown(getByLabelText('Minute'), { key: 'ArrowUp' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('disables both inputs when disabled prop is true', () => {
    const { getByLabelText } = render(
      <TimeInput onChange={jest.fn()} disabled hourLabel="Hour" minuteLabel="Minute" />
    )
    expect((getByLabelText('Hour') as HTMLInputElement).disabled).toBe(true)
    expect((getByLabelText('Minute') as HTMLInputElement).disabled).toBe(true)
  })

  it('snaps minute to nearest step on direct numeric input', () => {
    const onChange = jest.fn()
    const { getByLabelText } = render(
      <TimeInput value="10:00" onChange={onChange} minuteStep={30} hourLabel="Hour" minuteLabel="Minute" />
    )
    fireEvent.change(getByLabelText('Minute'), { target: { value: '22' } })
    // 22 rounded to nearest 30 = 30
    expect(onChange).toHaveBeenCalledWith('10:30')
  })
})
