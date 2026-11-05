/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { CounterInput } from '../counter-input'

describe('CounterInput primitive', () => {
  it('renders the value passed via the value prop', () => {
    render(<CounterInput value={5} onChange={() => {}} />)
    const input = screen.getByRole('spinbutton') as HTMLInputElement
    expect(input.value).toBe('5')
  })

  it('renders an empty string when value is null', () => {
    render(<CounterInput value={null} onChange={() => {}} />)
    const input = screen.getByRole('spinbutton') as HTMLInputElement
    expect(input.value).toBe('')
  })

  it('increments by step when + is clicked', () => {
    const onChange = jest.fn()
    render(<CounterInput value={3} onChange={onChange} step={2} />)
    fireEvent.click(screen.getByRole('button', { name: 'Increase' }))
    expect(onChange).toHaveBeenCalledWith(5)
  })

  it('decrements by step when - is clicked', () => {
    const onChange = jest.fn()
    render(<CounterInput value={10} onChange={onChange} step={3} />)
    fireEvent.click(screen.getByRole('button', { name: 'Decrease' }))
    expect(onChange).toHaveBeenCalledWith(7)
  })

  it('defaults step to 1', () => {
    const onChange = jest.fn()
    render(<CounterInput value={0} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Increase' }))
    expect(onChange).toHaveBeenCalledWith(1)
  })

  it('clamps to max when incrementing past max', () => {
    const onChange = jest.fn()
    render(<CounterInput value={9} onChange={onChange} max={10} step={5} />)
    fireEvent.click(screen.getByRole('button', { name: 'Increase' }))
    expect(onChange).toHaveBeenCalledWith(10)
  })

  it('clamps to min when decrementing below min', () => {
    const onChange = jest.fn()
    render(<CounterInput value={2} onChange={onChange} min={0} step={5} />)
    fireEvent.click(screen.getByRole('button', { name: 'Decrease' }))
    expect(onChange).toHaveBeenCalledWith(0)
  })

  it('disables the increment button when value is at max', () => {
    render(<CounterInput value={10} onChange={() => {}} max={10} />)
    expect(screen.getByRole('button', { name: 'Increase' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Decrease' })).not.toBeDisabled()
  })

  it('disables the decrement button when value is at min', () => {
    render(<CounterInput value={1} onChange={() => {}} min={1} />)
    expect(screen.getByRole('button', { name: 'Decrease' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Increase' })).not.toBeDisabled()
  })

  it('disables both buttons when disabled prop is set', () => {
    render(<CounterInput value={5} onChange={() => {}} disabled />)
    expect(screen.getByRole('button', { name: 'Decrease' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Increase' })).toBeDisabled()
    expect(screen.getByRole('spinbutton')).toBeDisabled()
  })

  it('commits valid number typed directly', () => {
    const onChange = jest.fn()
    render(<CounterInput value={0} onChange={onChange} />)
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '42' } })
    expect(onChange).toHaveBeenCalledWith(42)
  })

  it('emits null when input is cleared', () => {
    const onChange = jest.fn()
    render(<CounterInput value={5} onChange={onChange} />)
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('clamps typed value to max', () => {
    const onChange = jest.fn()
    render(<CounterInput value={0} onChange={onChange} max={100} />)
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '999' } })
    expect(onChange).toHaveBeenCalledWith(100)
  })

  it('clamps typed value to min', () => {
    const onChange = jest.fn()
    render(<CounterInput value={0} onChange={onChange} min={1} />)
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '-5' } })
    expect(onChange).toHaveBeenCalledWith(1)
  })

  it('formats output to precision decimals', () => {
    const onChange = jest.fn()
    render(<CounterInput value={1} onChange={onChange} precision={2} step={0.5} />)
    const input = screen.getByRole('spinbutton') as HTMLInputElement
    expect(input.value).toBe('1.00')
    fireEvent.click(screen.getByRole('button', { name: 'Increase' }))
    expect(onChange).toHaveBeenCalledWith(1.5)
  })

  it('ArrowUp increments by step', () => {
    const onChange = jest.fn()
    render(<CounterInput value={2} onChange={onChange} step={3} />)
    fireEvent.keyDown(screen.getByRole('spinbutton'), { key: 'ArrowUp' })
    expect(onChange).toHaveBeenCalledWith(5)
  })

  it('ArrowDown decrements by step', () => {
    const onChange = jest.fn()
    render(<CounterInput value={5} onChange={onChange} step={2} />)
    fireEvent.keyDown(screen.getByRole('spinbutton'), { key: 'ArrowDown' })
    expect(onChange).toHaveBeenCalledWith(3)
  })

  it('uncontrolled mode keeps internal state and emits onChange', () => {
    const onChange = jest.fn()
    render(<CounterInput onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Increase' }))
    expect(onChange).toHaveBeenCalledWith(1)
    const input = screen.getByRole('spinbutton') as HTMLInputElement
    expect(input.value).toBe('1')
  })

  it('honors custom decrement / increment aria labels', () => {
    render(
      <CounterInput
        value={0}
        onChange={() => {}}
        decrementAriaLabel="Zmniejsz"
        incrementAriaLabel="Zwiększ"
      />,
    )
    expect(screen.getByRole('button', { name: 'Zmniejsz' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zwiększ' })).toBeInTheDocument()
  })

  it('renders aria-invalid styling when aria-invalid is set', () => {
    const { container } = render(
      <CounterInput value={5} onChange={() => {}} aria-invalid />,
    )
    const input = container.querySelector('input')
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  it('applies size variants to the wrapper', () => {
    const { container, rerender } = render(<CounterInput value={1} onChange={() => {}} size="sm" />)
    expect(container.querySelector('[data-slot="counter-input"]')).toHaveClass('h-8')
    rerender(<CounterInput value={1} onChange={() => {}} size="default" />)
    expect(container.querySelector('[data-slot="counter-input"]')).toHaveClass('h-9')
    rerender(<CounterInput value={1} onChange={() => {}} size="lg" />)
    expect(container.querySelector('[data-slot="counter-input"]')).toHaveClass('h-10')
  })
})
