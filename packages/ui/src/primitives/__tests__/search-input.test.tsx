/** @jest-environment jsdom */

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}))

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { SearchInput } from '../search-input'

function Harness(initial: string, props: Partial<React.ComponentProps<typeof SearchInput>> = {}) {
  const { onChange: consumerOnChange, ...rest } = props
  function Wrapped() {
    const [value, setValue] = React.useState(initial)
    return (
      <SearchInput
        {...rest}
        value={value}
        onChange={(next) => {
          setValue(next)
          consumerOnChange?.(next)
        }}
      />
    )
  }
  return render(<Wrapped />)
}

describe('SearchInput primitive', () => {
  it('renders an input with type="search"', () => {
    const { container } = Harness('')
    const input = container.querySelector('input') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.type).toBe('search')
  })

  it('exposes the searchbox ARIA role (matches Playwright getByRole expectations)', () => {
    Harness('')
    expect(screen.getByRole('searchbox')).toBeInTheDocument()
  })

  it('uses the translated placeholder fallback', () => {
    Harness('')
    expect(screen.getByPlaceholderText('Search…')).toBeInTheDocument()
  })

  it('honors a consumer-supplied placeholder over the i18n fallback', () => {
    Harness('', { placeholder: 'Find a customer' })
    expect(screen.getByPlaceholderText('Find a customer')).toBeInTheDocument()
  })

  it('does not render the clear button when value is empty', () => {
    Harness('')
    expect(screen.queryByRole('button', { name: /clear search/i })).toBeNull()
  })

  it('renders the clear button when value is non-empty', () => {
    Harness('jan')
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument()
  })

  it('clicking the clear button calls onChange("") when no onClear is supplied', () => {
    const onChange = jest.fn()
    Harness('jan', { onChange })
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('clicking the clear button calls onClear instead of onChange when onClear is supplied', () => {
    const onChange = jest.fn()
    const onClear = jest.fn()
    Harness('jan', { onChange, onClear })
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(onClear).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('hides the clear button when clearable=false even with non-empty value', () => {
    Harness('jan', { clearable: false })
    expect(screen.queryByRole('button', { name: /clear search/i })).toBeNull()
  })

  it('hides the clear button when disabled', () => {
    Harness('jan', { disabled: true })
    expect(screen.queryByRole('button', { name: /clear search/i })).toBeNull()
  })

  it('forwards typing to onChange', () => {
    const onChange = jest.fn()
    Harness('', { onChange })
    const input = screen.getByRole('searchbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'kowalski' } })
    expect(onChange).toHaveBeenCalledWith('kowalski')
  })
})
