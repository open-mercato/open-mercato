/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { DigitInput } from '../digit-input'

describe('DigitInput primitive', () => {
  it('renders 6 cells by default', () => {
    const { container } = render(<DigitInput />)
    const cells = container.querySelectorAll('[data-slot="digit-input-cell"]')
    expect(cells).toHaveLength(6)
  })

  it('honors the length prop', () => {
    const { container } = render(<DigitInput length={4} />)
    const cells = container.querySelectorAll('[data-slot="digit-input-cell"]')
    expect(cells).toHaveLength(4)
  })

  it('renders the value distributed across cells', () => {
    const { container } = render(<DigitInput value="12" length={4} onChange={() => {}} />)
    const cells = container.querySelectorAll<HTMLInputElement>('[data-slot="digit-input-cell"]')
    expect(cells[0].value).toBe('1')
    expect(cells[1].value).toBe('2')
    expect(cells[2].value).toBe('')
    expect(cells[3].value).toBe('')
  })

  it('focuses the next cell after typing a digit', () => {
    const { container } = render(<DigitInput length={4} onChange={() => {}} />)
    const cells = container.querySelectorAll<HTMLInputElement>('[data-slot="digit-input-cell"]')
    cells[0].focus()
    fireEvent.change(cells[0], { target: { value: '7' } })
    expect(document.activeElement).toBe(cells[1])
  })

  it('commits typed digit via onChange', () => {
    const onChange = jest.fn()
    const { container } = render(<DigitInput length={4} onChange={onChange} />)
    const cells = container.querySelectorAll<HTMLInputElement>('[data-slot="digit-input-cell"]')
    fireEvent.change(cells[0], { target: { value: '5' } })
    expect(onChange).toHaveBeenCalledWith('5')
  })

  it('rejects non-digit characters when inputMode is numeric (default)', () => {
    const onChange = jest.fn()
    const { container } = render(<DigitInput length={4} onChange={onChange} />)
    const cells = container.querySelectorAll<HTMLInputElement>('[data-slot="digit-input-cell"]')
    fireEvent.change(cells[0], { target: { value: 'a' } })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('accepts non-digit characters when inputMode="text"', () => {
    const onChange = jest.fn()
    const { container } = render(<DigitInput length={4} inputMode="text" onChange={onChange} />)
    const cells = container.querySelectorAll<HTMLInputElement>('[data-slot="digit-input-cell"]')
    fireEvent.change(cells[0], { target: { value: 'X' } })
    expect(onChange).toHaveBeenCalledWith('X')
  })

  it('Backspace on an empty cell focuses the previous cell and clears its value', () => {
    const onChange = jest.fn()
    const { container } = render(
      <DigitInput value="12" length={4} onChange={onChange} />,
    )
    const cells = container.querySelectorAll<HTMLInputElement>('[data-slot="digit-input-cell"]')
    cells[2].focus()
    fireEvent.keyDown(cells[2], { key: 'Backspace' })
    expect(document.activeElement).toBe(cells[1])
    expect(onChange).toHaveBeenCalledWith('1')
  })

  it('ArrowLeft moves focus to the previous cell', () => {
    const { container } = render(<DigitInput length={4} onChange={() => {}} />)
    const cells = container.querySelectorAll<HTMLInputElement>('[data-slot="digit-input-cell"]')
    cells[2].focus()
    fireEvent.keyDown(cells[2], { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(cells[1])
  })

  it('ArrowRight moves focus to the next cell', () => {
    const { container } = render(<DigitInput length={4} onChange={() => {}} />)
    const cells = container.querySelectorAll<HTMLInputElement>('[data-slot="digit-input-cell"]')
    cells[1].focus()
    fireEvent.keyDown(cells[1], { key: 'ArrowRight' })
    expect(document.activeElement).toBe(cells[2])
  })

  it('distributes a pasted string across cells and fires onComplete when filled', () => {
    const onChange = jest.fn()
    const onComplete = jest.fn()
    const { container } = render(
      <DigitInput length={4} onChange={onChange} onComplete={onComplete} />,
    )
    const cells = container.querySelectorAll<HTMLInputElement>('[data-slot="digit-input-cell"]')
    fireEvent.paste(cells[0], {
      clipboardData: { getData: () => '5678' },
    })
    expect(onChange).toHaveBeenCalledWith('5678')
    expect(onComplete).toHaveBeenCalledWith('5678')
  })

  it('filters non-digit characters out of pasted strings in numeric mode', () => {
    const onChange = jest.fn()
    const { container } = render(<DigitInput length={4} onChange={onChange} />)
    const cells = container.querySelectorAll<HTMLInputElement>('[data-slot="digit-input-cell"]')
    fireEvent.paste(cells[0], {
      clipboardData: { getData: () => '1a2b3c4d' },
    })
    expect(onChange).toHaveBeenCalledWith('1234')
  })

  it('renders each cell as type="password" when mask is true', () => {
    const { container } = render(
      <DigitInput value="12" length={2} mask onChange={() => {}} />,
    )
    const cells = container.querySelectorAll<HTMLInputElement>('[data-slot="digit-input-cell"]')
    cells.forEach((cell) => expect(cell.type).toBe('password'))
  })

  it('disables every cell when disabled prop is set', () => {
    const { container } = render(<DigitInput length={4} disabled onChange={() => {}} />)
    const cells = container.querySelectorAll<HTMLInputElement>('[data-slot="digit-input-cell"]')
    cells.forEach((cell) => expect(cell).toBeDisabled())
  })

  it('uncontrolled mode keeps internal state and emits onChange', () => {
    const onChange = jest.fn()
    const { container } = render(<DigitInput length={4} onChange={onChange} />)
    const cells = container.querySelectorAll<HTMLInputElement>('[data-slot="digit-input-cell"]')
    fireEvent.change(cells[0], { target: { value: '1' } })
    fireEvent.change(cells[1], { target: { value: '2' } })
    expect(onChange).toHaveBeenLastCalledWith('12')
    expect(cells[0].value).toBe('1')
    expect(cells[1].value).toBe('2')
  })

  it('aria-invalid propagates to the group wrapper and to each cell', () => {
    const { container } = render(
      <DigitInput length={2} value="12" onChange={() => {}} aria-invalid />,
    )
    const wrapper = container.querySelector('[data-slot="digit-input"]')
    expect(wrapper).toHaveAttribute('aria-invalid', 'true')
    const cells = container.querySelectorAll('[data-slot="digit-input-cell"]')
    cells.forEach((cell) => expect(cell).toHaveAttribute('aria-invalid', 'true'))
  })

  it('uses a provided aria-label for the group and cell labels', () => {
    render(<DigitInput length={3} aria-label="Two factor code" onChange={() => {}} />)
    expect(screen.getByRole('group', { name: 'Two factor code' })).toBeInTheDocument()
    expect(screen.getByLabelText('Two factor code digit 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Two factor code digit 2')).toBeInTheDocument()
    expect(screen.getByLabelText('Two factor code digit 3')).toBeInTheDocument()
  })

  it('forwards id and name only to the first cell', () => {
    const { container } = render(
      <DigitInput length={3} id="otp" name="code" onChange={() => {}} />,
    )
    const cells = container.querySelectorAll<HTMLInputElement>('[data-slot="digit-input-cell"]')
    expect(cells[0].id).toBe('otp')
    expect(cells[0].name).toBe('code')
    expect(cells[1].id).toBe('')
    expect(cells[1].name).toBe('')
  })
})
