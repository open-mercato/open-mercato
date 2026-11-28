import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Input } from '../primitives/input'

describe('Input.Field', () => {
  it('wires label, helper and error to the control', () => {
    render(
      <Input.Field label="Postcode" helper="Format 00-000" error="Enter a postcode in the format 00-000" required>
        <Input defaultValue="31-05" />
      </Input.Field>,
    )
    const input = screen.getByLabelText(/Postcode/)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toBeRequired()
    const described = input.getAttribute('aria-describedby')?.split(' ') ?? []
    expect(described).toHaveLength(2)
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a postcode in the format 00-000')
    expect(screen.getByText('Format 00-000')).toHaveAttribute('id', described[1])
  })
})

describe('Input.Stepper', () => {
  const labels = { decrease: 'Decrease quantity', increase: 'Increase quantity', value: 'Quantity' }

  function Harness({ min = 1, max = 5, removeAtMin = false }: { min?: number; max?: number; removeAtMin?: boolean }) {
    const [value, setValue] = React.useState(1)
    return <Input.Stepper value={value} onValueChange={setValue} min={min} max={max} removeAtMin={removeAtMin} labels={labels} />
  }

  it('steps within min and max and disables the ends', async () => {
    render(<Harness />)
    const increase = screen.getByRole('button', { name: 'Increase quantity' })
    const decrease = screen.getByRole('button', { name: 'Decrease quantity' })
    expect(decrease).toBeDisabled()
    await userEvent.click(increase)
    expect(screen.getByRole('spinbutton', { name: 'Quantity' })).toHaveValue(2)
    expect(decrease).toBeEnabled()
    for (let index = 0; index < 5; index += 1) await userEvent.click(increase)
    expect(screen.getByRole('spinbutton', { name: 'Quantity' })).toHaveValue(5)
    expect(increase).toBeDisabled()
  })

  it('keeps the decrease button enabled at min when removeAtMin is set and emits min - step', async () => {
    const onValueChange = jest.fn()
    render(<Input.Stepper value={1} onValueChange={onValueChange} min={1} removeAtMin labels={labels} />)
    const decrease = screen.getByRole('button', { name: 'Decrease quantity' })
    expect(decrease).toBeEnabled()
    await userEvent.click(decrease)
    expect(onValueChange).toHaveBeenCalledWith(0)
  })

  it('clamps typed values and announces the field politely', async () => {
    const onValueChange = jest.fn()
    render(<Input.Stepper value={2} onValueChange={onValueChange} min={1} max={5} labels={labels} />)
    const field = screen.getByRole('spinbutton', { name: 'Quantity' })
    expect(field).toHaveAttribute('aria-live', 'polite')
    await userEvent.clear(field)
    await userEvent.type(field, '9')
    expect(onValueChange).toHaveBeenLastCalledWith(5)
  })
})

describe('Input.Search', () => {
  it('shows a labelled clear button only with a value', async () => {
    const onClear = jest.fn()
    const { rerender } = render(<Input.Search value="" onChange={() => {}} onClear={onClear} clearLabel="Clear search" aria-label="Search" />)
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
    rerender(<Input.Search value="kenya" onChange={() => {}} onClear={onClear} clearLabel="Clear search" aria-label="Search" />)
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(onClear).toHaveBeenCalled()
  })
})
