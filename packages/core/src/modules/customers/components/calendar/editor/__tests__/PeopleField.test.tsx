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

function renderField(value: EditorParticipant[], onChange: jest.Mock, mode: 'multi' | 'single' = 'multi') {
  return renderWithProviders(
    <PeopleField
      mode={mode}
      placeholder="Add people…"
      ariaLabel="Participants"
      value={value}
      onChange={onChange}
      includeCustomers
    />,
  )
}

async function typeQuery(text: string) {
  const input = screen.getByRole('combobox')
  await act(async () => {
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: text } })
  })
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

  it('offers an unmatched typed email as a guest and adds it without a userId', async () => {
    const onChange = jest.fn()
    await act(async () => {
      renderField([], onChange)
    })

    await typeQuery(' Guest@Example.ORG ')

    const guestOption = await screen.findByRole('option', { name: /guest@example\.org/i })
    await act(async () => {
      fireEvent.click(guestOption)
    })

    expect(onChange).toHaveBeenCalledWith([
      { name: 'guest@example.org', email: 'guest@example.org', isCustomer: false },
    ])
  })

  it('does not offer a guest for a query that is not a valid email', async () => {
    const onChange = jest.fn()
    await act(async () => {
      renderField([], onChange)
    })

    await typeQuery('not-an-email')

    expect(screen.queryByRole('option')).toBeNull()
    expect(await screen.findByText('No results')).toBeInTheDocument()
  })

  it('does not offer a guest already present as a participant', async () => {
    const onChange = jest.fn()
    const guest: EditorParticipant = { name: 'Guest', email: 'guest@example.org', isCustomer: false }
    await act(async () => {
      renderField([guest], onChange)
    })

    await typeQuery('GUEST@example.org')

    expect(screen.queryByRole('option')).toBeNull()
  })

  it('never offers a guest in single mode — the assignee must be a real staff user', async () => {
    const onChange = jest.fn()
    await act(async () => {
      renderField([], onChange, 'single')
    })

    await typeQuery('guest@example.org')

    expect(screen.queryByRole('option')).toBeNull()
  })
})
