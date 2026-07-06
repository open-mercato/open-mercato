/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { format } from 'date-fns/format'
import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import { DealCustomFieldControl } from '../dealCustomFieldControl'

// A fixed instant the mocked DatePicker emits; expectations derive from the same value so the
// "yyyy-MM-dd" assertion stays timezone-independent.
const mockFixedDate = new Date('2026-05-24T12:00:00.000Z')

// Radix Select / DatePicker / TagInput / Checkbox depend on portals + pointer APIs jsdom lacks,
// so we stub them with thin controls that expose their change callbacks. Input/Textarea/Label stay
// real — the unit under test is DealCustomFieldControl's type routing + value coercion.
jest.mock('@open-mercato/ui/primitives/select', () => {
  const React = require('react')
  const Ctx = React.createContext({ onValueChange: (_value: string) => {} })
  return {
    Select: ({ onValueChange, children }: any) =>
      React.createElement(Ctx.Provider, { value: { onValueChange } }, children),
    SelectTrigger: ({ children }: any) => React.createElement('div', null, children),
    SelectTriggerLeading: ({ children }: any) => React.createElement('span', null, children),
    SelectValue: ({ placeholder, children }: any) =>
      React.createElement('span', null, children != null ? children : placeholder),
    SelectContent: ({ children }: any) => React.createElement('div', null, children),
    SelectItem: ({ value, children }: any) => {
      const ctx = React.useContext(Ctx)
      return React.createElement('button', { type: 'button', onClick: () => ctx.onValueChange(value) }, children)
    },
  }
})

jest.mock('@open-mercato/ui/primitives/checkbox', () => {
  const React = require('react')
  return {
    Checkbox: ({ checked, onCheckedChange }: any) =>
      React.createElement('input', {
        type: 'checkbox',
        checked: !!checked,
        onChange: (event: any) => onCheckedChange(event.target.checked),
      }),
  }
})

jest.mock('@open-mercato/ui/primitives/checkbox-field', () => {
  const React = require('react')
  return {
    CheckboxField: ({ label, checked, onCheckedChange }: any) =>
      React.createElement('input', {
        type: 'checkbox',
        'aria-label': label,
        checked: !!checked,
        onChange: (event: any) => onCheckedChange(event.target.checked),
      }),
  }
})

jest.mock('@open-mercato/ui/primitives/date-picker', () => {
  const React = require('react')
  return {
    DatePicker: ({ onChange }: any) =>
      React.createElement(
        'div',
        null,
        React.createElement(
          'button',
          { type: 'button', 'data-testid': 'dp-set', onClick: () => onChange(mockFixedDate) },
          'set',
        ),
        React.createElement(
          'button',
          { type: 'button', 'data-testid': 'dp-clear', onClick: () => onChange(null) },
          'clear',
        ),
      ),
  }
})

jest.mock('@open-mercato/ui/primitives/tag-input', () => {
  const React = require('react')
  return {
    TagInput: ({ value, onChange }: any) =>
      React.createElement('input', {
        'data-testid': 'tag-input',
        defaultValue: (Array.isArray(value) ? value : []).join(','),
        onChange: (event: any) => onChange(event.target.value ? event.target.value.split(',') : []),
      }),
  }
})

function makeField(partial: Partial<CrudField> & { id: string; type: string }): CrudField {
  return { label: partial.id, ...partial } as unknown as CrudField
}

describe('DealCustomFieldControl', () => {
  it('renders a text field and emits the raw string', () => {
    const onChange = jest.fn()
    render(<DealCustomFieldControl field={makeField({ id: 'cf_name', type: 'text', label: 'Name' })} value="" onChange={onChange} />)
    expect(screen.getByText('Name')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hello' } })
    expect(onChange).toHaveBeenCalledWith('Hello')
  })

  it('shows the required marker and error message', () => {
    render(
      <DealCustomFieldControl
        field={makeField({ id: 'cf_reason', type: 'text', label: 'Reason', required: true })}
        value=""
        onChange={() => {}}
        error="Required"
      />,
    )
    expect(screen.getByText('*')).toBeInTheDocument()
    expect(screen.getByText('Required')).toBeInTheDocument()
  })

  it('coerces a numeric field to a number, and clears to undefined', () => {
    const onChange = jest.fn()
    // Render with a non-empty controlled value so both changes (to '42' and to '') differ from the
    // displayed value and therefore fire onChange.
    render(<DealCustomFieldControl field={makeField({ id: 'cf_count', type: 'number', label: 'Count' })} value={5} onChange={onChange} />)
    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '42' } })
    expect(onChange).toHaveBeenLastCalledWith(42)
    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })

  it('emits a boolean for a checkbox field', () => {
    const onChange = jest.fn()
    render(<DealCustomFieldControl field={makeField({ id: 'cf_active', type: 'checkbox', label: 'Active' })} value={false} onChange={onChange} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Active' }))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('selects and clears a single-select field', () => {
    const onChange = jest.fn()
    render(
      <DealCustomFieldControl
        field={makeField({
          id: 'cf_priority',
          type: 'select',
          label: 'Priority',
          options: [
            { value: 'low', label: 'Low' },
            { value: 'high', label: 'High' },
          ],
        })}
        value="low"
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'High' }))
    expect(onChange).toHaveBeenLastCalledWith('high')
    fireEvent.click(screen.getByRole('button', { name: '—' }))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('toggles a value into the array for a multi-select field', () => {
    const onChange = jest.fn()
    render(
      <DealCustomFieldControl
        field={makeField({
          id: 'cf_tags',
          type: 'select',
          label: 'Tags',
          multiple: true,
          options: [
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ],
        })}
        value={[]}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    expect(onChange).toHaveBeenCalledWith(['a'])
  })

  it('emits a string array for a tags field', () => {
    const onChange = jest.fn()
    render(<DealCustomFieldControl field={makeField({ id: 'cf_labels', type: 'tags', label: 'Labels' })} value={[]} onChange={onChange} />)
    fireEvent.change(screen.getByTestId('tag-input'), { target: { value: 'x,y' } })
    expect(onChange).toHaveBeenCalledWith(['x', 'y'])
  })

  it('formats a date field as yyyy-MM-dd and clears to undefined', () => {
    const onChange = jest.fn()
    render(<DealCustomFieldControl field={makeField({ id: 'cf_due', type: 'date', label: 'Due' })} value="" onChange={onChange} />)
    fireEvent.click(screen.getByTestId('dp-set'))
    expect(onChange).toHaveBeenLastCalledWith(format(mockFixedDate, 'yyyy-MM-dd'))
    fireEvent.click(screen.getByTestId('dp-clear'))
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })

  it('emits an ISO string for a datetime field', () => {
    const onChange = jest.fn()
    render(<DealCustomFieldControl field={makeField({ id: 'cf_at', type: 'datetime', label: 'At' })} value="" onChange={onChange} />)
    fireEvent.click(screen.getByTestId('dp-set'))
    expect(onChange).toHaveBeenLastCalledWith(mockFixedDate.toISOString())
  })

  it('delegates a custom-type field to its own registry component', () => {
    const onChange = jest.fn()
    const component = jest.fn((args: { value: unknown }) => (
      <div data-testid="custom-control">custom:{String(args.value)}</div>
    ))
    render(
      <DealCustomFieldControl
        field={makeField({ id: 'cf_widget', type: 'custom', label: 'Widget', component })}
        value="abc"
        onChange={onChange}
      />,
    )
    expect(screen.getByTestId('custom-control')).toHaveTextContent('custom:abc')
    expect(component).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cf_widget', value: 'abc', setValue: onChange, disabled: false }),
    )
  })
})
