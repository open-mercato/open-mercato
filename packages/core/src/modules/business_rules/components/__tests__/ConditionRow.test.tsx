/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ConditionRow } from '../ConditionRow'

describe('ConditionRow', () => {
  const defaultProps = {
    onChange: jest.fn(),
    onDelete: jest.fn(),
  }

  it('associates the visible labels with the condition controls', () => {
    renderWithProviders(
      <ConditionRow
        {...defaultProps}
        condition={{ field: 'status', operator: '=', value: 'active' }}
      />,
    )

    expect(screen.getByRole('textbox', { name: 'business_rules.components.conditionRow.field' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'business_rules.components.conditionRow.operator' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'business_rules.components.conditionRow.value' })).toBeInTheDocument()
  })

  it('labels the comparison input when comparing two fields', () => {
    renderWithProviders(
      <ConditionRow
        {...defaultProps}
        condition={{ field: 'total', operator: '>', value: null, valueField: 'limit' }}
      />,
    )

    expect(screen.getByRole('textbox', { name: 'business_rules.components.conditionRow.compareToField' })).toBeInTheDocument()
  })
})
