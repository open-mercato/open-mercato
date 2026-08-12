/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { PeopleField } from '../PeopleField'
import type { EditorParticipant } from '../../../../lib/calendar/editorPayload'

jest.mock('../lookups', () => ({
  searchPeopleOptions: jest.fn().mockResolvedValue([]),
}))

function renderField(value: EditorParticipant[], onChange: jest.Mock) {
  return renderWithProviders(
    <PeopleField
      mode="multi"
      placeholder="Add people…"
      ariaLabel="Participants"
      value={value}
      onChange={onChange}
      includeCustomers
    />,
  )
}

describe('PeopleField', () => {
  it('removes the clicked guest chip by position when multiple guests have no userId', async () => {
    const guestOne: EditorParticipant = { name: 'Guest One', email: 'guest-one@example.org', isCustomer: false }
    const guestTwo: EditorParticipant = { name: 'Guest Two', email: 'guest-two@example.org', isCustomer: false }
    const onChange = jest.fn()

    await act(async () => {
      renderField([guestOne, guestTwo], onChange)
    })

    const removeButtons = screen.getAllByRole('button', { name: /Remove/ })
    expect(removeButtons).toHaveLength(2)

    await act(async () => {
      fireEvent.click(removeButtons[1])
    })

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith([guestOne])
  })
})
