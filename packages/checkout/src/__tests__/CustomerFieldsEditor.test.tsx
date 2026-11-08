/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CustomerFieldsEditor } from '../modules/checkout/components/CustomerFieldsEditor'

describe('CustomerFieldsEditor', () => {
  it('keeps the Polish required label accessible and updates only the selected field', () => {
    const value = ['firstName', 'lastName', 'email'].map((key, index) => ({
      key,
      label: key,
      kind: 'text' as const,
      required: true,
      fixed: true,
      sortOrder: index,
      options: [],
    }))
    const onChange = jest.fn()
    const { getAllByRole } = renderWithProviders(
      <CustomerFieldsEditor value={value} onChange={onChange} />,
      { locale: 'pl', dict: { 'checkout.customerFieldsEditor.columns.required': 'Wymagane' } },
    )

    const checkboxes = getAllByRole('checkbox', { name: 'Wymagane' })
    expect(checkboxes).toHaveLength(3)
    fireEvent.click(checkboxes[1])
    expect(onChange).toHaveBeenCalledWith(value.map((field, index) => (
      index === 1 ? { ...field, required: false } : field
    )))
  })

  it('renders nested validation errors inline on the matching field', () => {
    const value = [
      {
        key: 'first Name',
        label: 'First name',
        kind: 'text' as const,
        required: true,
        fixed: false,
        placeholder: 'Jane',
        sortOrder: 0,
        options: [],
      },
    ]

    const { getByDisplayValue, getByText } = renderWithProviders(
      <CustomerFieldsEditor
        value={value}
        onChange={() => {}}
        errors={{ 'customerFieldsSchema.0.key': 'Use camelCase starting with a letter.' }}
      />,
    )

    expect(getByText('Use camelCase starting with a letter.')).toBeTruthy()
    expect(getByDisplayValue('first Name').getAttribute('aria-invalid')).toBe('true')
  })
})
