/** @jest-environment jsdom */

import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ComboboxInput } from '../ComboboxInput'

type HarnessProps = Partial<React.ComponentProps<typeof ComboboxInput>> & {
  initialValue?: string
}

function Harness({ initialValue = '', onChange, ...rest }: HarnessProps) {
  const [value, setValue] = React.useState(initialValue)
  return (
    <div>
      <ComboboxInput
        value={value}
        onChange={(next) => {
          setValue(next)
          onChange?.(next)
        }}
        suggestions={[
          { value: 'red', label: 'Red' },
          { value: 'green', label: 'Green' },
        ]}
        {...rest}
      />
      <output data-testid="value">{value}</output>
    </div>
  )
}

function blurAndFlush(input: HTMLElement) {
  act(() => {
    fireEvent.blur(input)
  })
  act(() => {
    jest.advanceTimersByTime(250)
  })
}

describe('ComboboxInput clearable behavior', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers()
    })
    jest.useRealTimers()
  })

  it('reverts to current value on blur with empty input when not clearable and custom values disallowed', () => {
    const onChange = jest.fn()
    render(
      <Harness
        initialValue="red"
        clearable={false}
        allowCustomValues={false}
        onChange={onChange}
      />
    )

    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('Red')

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '' } })
    expect(input.value).toBe('')

    blurAndFlush(input)

    expect(input.value).toBe('Red')
    expect(screen.getByTestId('value')).toHaveTextContent('red')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('emits empty string on blur with empty input when clearable, regardless of allowCustomValues', () => {
    const onChange = jest.fn()
    render(
      <Harness
        initialValue="red"
        clearable
        allowCustomValues={false}
        onChange={onChange}
      />
    )

    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '' } })

    blurAndFlush(input)

    expect(onChange).toHaveBeenCalledWith('')
    expect(screen.getByTestId('value')).toHaveTextContent('')
    expect(input.value).toBe('')
  })

  it('renders a clear button when clearable and a value is set, and clears via click', () => {
    const onChange = jest.fn()
    render(<Harness initialValue="red" clearable onChange={onChange} />)

    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('Red')

    const clearBtn = screen.getByRole('button', { name: /clear value/i })
    fireEvent.click(clearBtn)

    expect(onChange).toHaveBeenCalledWith('')
    expect(screen.getByTestId('value')).toHaveTextContent('')
    expect(input.value).toBe('')
  })

  it('does not render the clear button when clearable is false', () => {
    render(<Harness initialValue="red" clearable={false} />)
    expect(screen.queryByRole('button', { name: /clear value/i })).toBeNull()
  })

  it('does not render the clear button when clearable is true but no value is set', () => {
    render(<Harness initialValue="" clearable />)
    expect(screen.queryByRole('button', { name: /clear value/i })).toBeNull()
  })
})
