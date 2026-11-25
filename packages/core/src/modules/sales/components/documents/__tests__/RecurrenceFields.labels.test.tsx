/** @jest-environment jsdom */

import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { RecurrenceFields, createRecurrenceDraft } from '../RecurrenceFields'

const draft = { ...createRecurrenceDraft({ frequency: 'monthly', startsOn: '2027-03-01', periodCount: 4 }), enabled: true }

function renderFields(errors?: React.ComponentProps<typeof RecurrenceFields>['errors']) {
  return renderWithProviders(<RecurrenceFields value={draft} onChange={jest.fn()} errors={errors} />)
}

describe('RecurrenceFields labels', () => {
  it('labels the frequency select trigger and the start date picker button', () => {
    renderFields()

    const frequency = screen.getByLabelText('Frequency')
    expect(frequency).toBe(screen.getByTestId('sales-recurrence-frequency'))
    expect(frequency).toHaveAttribute('role', 'combobox')
    expect(frequency).not.toHaveAttribute('aria-invalid')

    const startsOn = screen.getByLabelText('Start date')
    expect(startsOn.tagName).toBe('BUTTON')
    expect(screen.getByTestId('sales-recurrence-starts-on')).toContainElement(startsOn)
  })

  it('associates validation errors with the frequency and start date controls', () => {
    renderFields({ frequency: 'Choose a frequency.', startsOn: 'Pick a start date.' })

    const frequency = screen.getByLabelText('Frequency')
    expect(frequency).toHaveAttribute('aria-invalid', 'true')
    expect(frequency).toHaveAccessibleDescription('Choose a frequency.')

    expect(screen.getByLabelText('Start date')).toHaveAccessibleDescription('Pick a start date.')
  })
})
