/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import type { FieldContext, InjectionFieldDefinition } from '@open-mercato/shared/modules/widgets/injection'
import { InjectedField } from '../InjectedField'

const numberField: InjectionFieldDefinition = {
  id: 'amount',
  type: 'number',
  label: 'Amount',
}

const context = {} as FieldContext

// A stateful host, because that is how the field is really used: the value it reports
// flows straight back in as its `value` prop, so a transient parse failure that cleared
// the box would make the field impossible to type into.
function Harness({ onChange }: { onChange: (id: string, value: unknown) => void }) {
  const [value, setValue] = React.useState<unknown>('')
  return (
    <InjectedField
      field={numberField}
      value={value}
      onChange={(id, next) => {
        setValue(next)
        onChange(id, next)
      }}
      context={context}
      formData={{}}
    />
  )
}

// The locale is pinned to one that does NOT use a dot decimal separator; an en-US pin
// would pass on the buggy implementation too.
function renderField(locale: string, onChange: (id: string, value: unknown) => void) {
  const { container } = renderWithProviders(<Harness onChange={onChange} />, { locale })
  const input = container.querySelector('input')
  expect(input).not.toBeNull()
  return input as HTMLInputElement
}

describe('InjectedField number inputs accept the locale decimal separator (issue #5552)', () => {
  it('does not render a type="number" input, whose value the browser sanitizes per BROWSER locale', () => {
    const input = renderField('pl', () => {})
    expect(input.getAttribute('type')).toBe('text')
    expect(input.getAttribute('inputMode')).toBe('decimal')
  })

  it('parses a comma-typed value under a Polish locale', () => {
    const onChange = jest.fn()
    const input = renderField('pl', onChange)

    fireEvent.change(input, { target: { value: '110,70' } })

    expect(onChange).toHaveBeenCalledWith('amount', 110.7)
  })

  it('still parses a dot-typed value, and reports a cleared field as undefined', () => {
    const onChange = jest.fn()
    const input = renderField('pl', onChange)

    fireEvent.change(input, { target: { value: '2.5' } })
    expect(onChange).toHaveBeenLastCalledWith('amount', 2.5)

    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith('amount', undefined)
  })

  it('reports an unparseable value as undefined rather than NaN', () => {
    const onChange = jest.fn()
    const input = renderField('pl', onChange)

    fireEvent.change(input, { target: { value: 'abc' } })

    expect(onChange).toHaveBeenLastCalledWith('amount', undefined)
  })

  it('keeps a half-typed decimal in the box on the way to a complete one', () => {
    const onChange = jest.fn()
    const input = renderField('pl', onChange)

    fireEvent.focus(input)
    // `110,` is not yet a number, but clearing the box here would make the value
    // impossible to finish typing in a controlled host.
    fireEvent.change(input, { target: { value: '110,' } })
    expect(input.value).toBe('110,')

    fireEvent.change(input, { target: { value: '110,70' } })
    expect(input.value).toBe('110,70')
    expect(onChange).toHaveBeenLastCalledWith('amount', 110.7)
  })
})
