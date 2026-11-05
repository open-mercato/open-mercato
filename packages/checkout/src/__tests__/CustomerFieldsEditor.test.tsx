/** @jest-environment jsdom */

import * as React from 'react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CustomerFieldsEditor } from '../modules/checkout/components/CustomerFieldsEditor'

describe('CustomerFieldsEditor', () => {
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
