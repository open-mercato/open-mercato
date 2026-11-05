import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { FormField } from '../form-field'
import { Input } from '../input'
import { Textarea } from '../textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../select'

describe.each([
  { name: 'Input', Control: Input },
  { name: 'Textarea', Control: Textarea },
])('FormField with $name', ({ Control }) => {
  it.each([
    { fieldDisabled: undefined, childDisabled: undefined, expected: false },
    { fieldDisabled: undefined, childDisabled: false, expected: false },
    { fieldDisabled: undefined, childDisabled: true, expected: true },
    { fieldDisabled: false, childDisabled: undefined, expected: false },
    { fieldDisabled: false, childDisabled: false, expected: false },
    { fieldDisabled: false, childDisabled: true, expected: true },
    { fieldDisabled: true, childDisabled: undefined, expected: true },
    { fieldDisabled: true, childDisabled: false, expected: true },
    { fieldDisabled: true, childDisabled: true, expected: true },
  ])(
    'renders disabled=$expected with field=$fieldDisabled and child=$childDisabled',
    ({ fieldDisabled, childDisabled, expected }) => {
      render(
        <FormField label="Amount" disabled={fieldDisabled}>
          <Control disabled={childDisabled} />
        </FormField>,
      )

      const control = screen.getByRole('textbox', { name: 'Amount' })
      if (expected) {
        expect(control).toBeDisabled()
      } else {
        expect(control).not.toBeDisabled()
      }
    },
  )

  it.each([false, true])('restores child disabled=%s when the field is re-enabled', (childDisabled) => {
    const { rerender } = render(
      <FormField label="Amount" disabled>
        <Control disabled={childDisabled} />
      </FormField>,
    )
    expect(screen.getByRole('textbox', { name: 'Amount' })).toBeDisabled()

    rerender(
      <FormField label="Amount" disabled={false}>
        <Control disabled={childDisabled} />
      </FormField>,
    )

    const control = screen.getByRole('textbox', { name: 'Amount' })
    if (childDisabled) {
      expect(control).toBeDisabled()
    } else {
      expect(control).not.toBeDisabled()
    }
  })

  it('updates the child disabled state independently of the field', () => {
    const { rerender } = render(
      <FormField label="Amount">
        <Control />
      </FormField>,
    )
    expect(screen.getByRole('textbox', { name: 'Amount' })).not.toBeDisabled()

    rerender(
      <FormField label="Amount">
        <Control disabled />
      </FormField>,
    )
    expect(screen.getByRole('textbox', { name: 'Amount' })).toBeDisabled()

    rerender(
      <FormField label="Amount">
        <Control disabled={false} />
      </FormField>,
    )
    expect(screen.getByRole('textbox', { name: 'Amount' })).not.toBeDisabled()
  })
})

describe('FormField with Select', () => {
  it.each([
    { fieldDisabled: undefined, childDisabled: true, expected: true },
    { fieldDisabled: false, childDisabled: true, expected: true },
    { fieldDisabled: true, childDisabled: undefined, expected: true },
    { fieldDisabled: undefined, childDisabled: undefined, expected: false },
  ])(
    'renders disabled=$expected with field=$fieldDisabled and child=$childDisabled',
    ({ fieldDisabled, childDisabled, expected }) => {
      render(
        <FormField label="Country" disabled={fieldDisabled}>
          <Select value="pl" onValueChange={() => {}} disabled={childDisabled}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pl">Poland</SelectItem>
            </SelectContent>
          </Select>
        </FormField>,
      )

      const trigger = screen.getByRole('combobox')
      if (expected) {
        expect(trigger).toBeDisabled()
      } else {
        expect(trigger).not.toBeDisabled()
      }
    },
  )
})

describe('FormField with a control that defaults to disabled', () => {
  function DefaultDisabledInput({ disabled = true, ...props }: React.ComponentProps<typeof Input>) {
    return <Input {...props} disabled={disabled} />
  }

  it.each([undefined, false])('preserves explicit child disabled=false with field disabled=%s', (disabled) => {
    render(
      <FormField label="Amount" disabled={disabled}>
        <DefaultDisabledInput disabled={false} />
      </FormField>,
    )

    expect(screen.getByRole('textbox', { name: 'Amount' })).not.toBeDisabled()
  })

  it('preserves the control default when disabled is omitted', () => {
    render(
      <FormField label="Amount">
        <DefaultDisabledInput />
      </FormField>,
    )

    expect(screen.getByRole('textbox', { name: 'Amount' })).toBeDisabled()
  })
})
